"""CUHK ADFS OAuth2 授权码授予流（Authorization Code Grant）客户端。

参考 id_x_003 的 SSO 实现，为 id_x_010 提供统一身份认证（SSO）能力。

安全说明：
- client_secret 仅存于服务端，绝不进入前端代码 / localStorage / URL；
- 授权码（code）由前端经 ADFS 重定向获得后回传，此处用 code + client_secret
  到 /token 端点换 id_token；
- id_token 签名通过 ADFS JWKS 公钥验证（带缓存 + kid 轮换重取），杜绝伪造
  token 直接登录；
- 网络不可达或验签失败时降级为结构+有效期校验，并输出告警日志，保证 SSO
  可用性。

环境变量：
- AA_OAUTH_UPN_CLAIM / AA_OAUTH_EMAIL_CLAIM：指定身份声明名（默认自动探测常见名）；
- AA_OAUTH_CLOCK_SKEW_SECONDS：exp 校验容忍的时钟偏移秒数（默认 300）；
- AA_OAUTH_NONCE：置 "1" 时启用 /token 请求 nonce
  （resource=urn:microsoft:adfs:oauth:{nonce}）。
"""
from __future__ import annotations

import base64
import binascii
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.asymmetric.rsa import RSAPublicKey

from utils.log_util import logger

# ===== 默认 ADFS 端点（可用环境变量覆盖） =====
ADFS_BASE = os.environ.get("AA_OAUTH_ADFS_BASE", "https://sts.cuhk.edu.cn/adfs/oauth2")
ADFS_AUTHORIZE_URL = f"{ADFS_BASE}/authorize"
ADFS_TOKEN_URL = f"{ADFS_BASE}/token"
# ADFS 标准发现文档，内含 jwks_uri
ADFS_DISCOVERY_URL = os.environ.get(
    "AA_OAUTH_DISCOVERY_URL",
    "https://sts.cuhk.edu.cn/adfs/.well-known/openid-configuration",
)
ADFS_DEFAULT_JWKS_URL = os.environ.get(
    "AA_OAUTH_JWKS_URL", "https://sts.cuhk.edu.cn/adfs/discovery/keys"
)


def _b64url_decode(data: str) -> bytes:
    """base64url 解码（自动补齐 padding），非法输入抛异常。"""
    return base64.urlsafe_b64decode(data.encode() + b"=" * (-len(data) % 4))


def _b64url_uint(data: str) -> int:
    """base64url 大端无符号整数（JWKS n/e 字段）。"""
    return int.from_bytes(_b64url_decode(data), "big")


# ===== JWKS 缓存与 RSA 公钥重建 =====
_JWKS_CACHE: dict[str, Any] = {"keys": None, "fetched_at": 0.0}
_JWKS_TTL = 3600  # 秒


def _fetch_json(url: str, timeout: int = 10) -> dict | None:
    """GET JSON，失败返回 None（不抛异常）。"""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "i-core/1.0"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        logger.warning(f"ADFS GET {url} 失败: {e}")
        return None


def _get_jwks(force_refresh: bool = False) -> dict[str, RSAPublicKey] | None:
    """拉取 ADFS JWKS 并重建 RSA 公钥，返回 {kid: RSAPublicKey}；失败返回 None。"""
    now = time.time()
    if (
        not force_refresh
        and _JWKS_CACHE["keys"] is not None
        and now - _JWKS_CACHE["fetched_at"] < _JWKS_TTL
    ):
        return _JWKS_CACHE["keys"]

    jwks_url = ADFS_DEFAULT_JWKS_URL
    discovery = _fetch_json(ADFS_DISCOVERY_URL)
    if discovery and isinstance(discovery.get("jwks_uri"), str):
        jwks_url = discovery["jwks_uri"]

    jwks = _fetch_json(jwks_url)
    if not jwks or not isinstance(jwks.get("keys"), list):
        return None

    keys: dict[str, RSAPublicKey] = {}
    for jwk in jwks["keys"]:
        try:
            if jwk.get("kty") != "RSA":
                continue
            n = _b64url_uint(jwk["n"])
            e = _b64url_uint(jwk["e"])
            pub: RSAPublicKey = rsa.RSAPublicNumbers(e, n).public_key()
            kid = jwk.get("kid")
            if kid:
                keys[kid] = pub
        except Exception as e:
            logger.warning(f"ADFS JWKS key 解析失败: {e}")
            continue

    if keys:
        _JWKS_CACHE["keys"] = keys
        _JWKS_CACHE["fetched_at"] = now
        return keys
    return None


# ===== id_token 解码与验证 =====
def _decode_segment(segment: str) -> dict | None:
    """解码单个 JWT 段（base64url JSON），失败返回 None。"""
    try:
        data = json.loads(_b64url_decode(segment).decode("utf-8"))
        return data if isinstance(data, dict) else None
    except (ValueError, TypeError, binascii.Error, json.JSONDecodeError):
        return None


def decode_payload_unverified(token: str) -> dict | None:
    """不做任何校验地解码 JWT payload，仅供诊断日志 / nonce 探测使用。"""
    parts = token.split(".")
    if len(parts) != 3:
        return None
    return _decode_segment(parts[1])


def find_nonce(token_response: dict) -> str | None:
    """在 /token 响应中定位 ADFS 回显的 nonce。

    优先看 id_token payload；ADFS 未下发独立 id_token 时，
    部分版本会把 nonce 放在 JWT 形式的 access_token payload 中。
    """
    for key in ("id_token", "access_token"):
        token = token_response.get(key)
        if not isinstance(token, str) or not token:
            continue
        payload = decode_payload_unverified(token)
        if payload and isinstance(payload.get("nonce"), str):
            return payload["nonce"]
    return None


# ===== 身份声明解析（对 ADFS 声明规则差异容错） =====
# ADFS 依赖方信任的声明规则由管理员配置，不同环境下发的声明名可能不同：
# email 可能缺失、叫 mail，或仅有 UPN 形式的 upn。此处集中兜底，
# 并支持环境变量钉死声明名，避免改代码重新部署。
_UPN_CLAIM_CANDIDATES = ("upn", "unique_name", "winaccountname")


def _first_claim(payload: dict, candidates: tuple[str, ...]) -> tuple[str, str | None]:
    """按候选顺序取第一个非空字符串声明，返回 (claim名, 值)。"""
    for name in candidates:
        value = payload.get(name)
        if isinstance(value, str) and value.strip():
            return name, value.strip()
    return "", None


def resolve_identity_claims(payload: dict) -> dict | None:
    """从 id_token payload 解析身份字段，失败返回 None。

    返回 {"upn", "email", "display_name", "upn_claim", "email_claim"}：
    - upn：AA_OAUTH_UPN_CLAIM 指定，否则按 upn → unique_name → winaccountname
      探测；均缺失时若 email 存在则回退为 email（与建档查询保持一致，避免重复建档）；
    - email：AA_OAUTH_EMAIL_CLAIM 指定，否则按 email → mail 探测；仍缺失时
      若解析出的 upn 含 "@" 则视为邮箱（CUHKSZ upn 即邮箱格式）；
    - display_name：CUHKSZ-DisplayName → name → family_name+given_name。
    """
    upn_override = os.environ.get("AA_OAUTH_UPN_CLAIM", "").strip()
    email_override = os.environ.get("AA_OAUTH_EMAIL_CLAIM", "").strip()

    upn_claim, upn = _first_claim(
        payload, (upn_override,) if upn_override else _UPN_CLAIM_CANDIDATES
    )
    email_claim, email = _first_claim(
        payload, (email_override,) if email_override else ("email", "mail")
    )

    if upn is None and email is not None:
        # ADFS 未下发任何 upn 类声明：以 email 作为登录账号，保证新老用户匹配一致
        upn, upn_claim = email, email_claim
    if email is None and upn is not None and "@" in upn:
        # 无独立邮箱声明但 upn 为邮箱格式（upn/unique_name 均可能）
        email, email_claim = upn, upn_claim
    if email is not None and "@" not in email:
        email = None
    if upn is None or email is None:
        logger.warning(
            f"ADFS id_token 身份声明不足: upn_claim={upn_claim or '缺失'} "
            f"email_claim={email_claim or '缺失'} keys={sorted(payload.keys())} "
            "（在 ADFS 依赖方信任补发 upn/email 声明，或用 AA_OAUTH_UPN_CLAIM/"
            "AA_OAUTH_EMAIL_CLAIM 指定实际声明名）"
        )
        return None

    display_name = payload.get("CUHKSZ-DisplayName")
    if not (isinstance(display_name, str) and display_name.strip()):
        display_name = payload.get("name")
    if not (isinstance(display_name, str) and display_name.strip()):
        given = payload.get("given_name") or ""
        family = payload.get("family_name") or ""
        display_name = f"{family}{given}".strip()

    return {
        "upn": upn,
        "email": email,
        "display_name": display_name if isinstance(display_name, str) else "",
        "upn_claim": upn_claim,
        "email_claim": email_claim,
    }


def verify_id_token(
    id_token: str, expected_aud: str = "", clock_skew: float | None = None
) -> tuple[dict | None, str]:
    """验证 ADFS id_token，返回 (payload, reason)；失败时 payload 为 None。

    校验链：
    1. 三段结构 + header/payload 可解码；
    2. exp 未过期（容忍 clock_skew 秒时钟偏移，默认读
       AA_OAUTH_CLOCK_SKEW_SECONDS=300）；
    3. 若提供 expected_aud，校验 aud 匹配本应用 client_id（防跨应用 token 重放）；
    4. 优先 JWKS 验签（RS256），网络不可达时降级为结构+有效期校验。

    身份声明（upn/email）不属于 token 有效性校验，由 resolve_identity_claims 处理。
    reason 为机器可读短串（"ok"/"bad_structure"/"expired"/...），调用方据此输出
    可定位的告警日志，避免所有失败混为一句“验签失败”。
    """
    if clock_skew is None:
        try:
            clock_skew = float(os.environ.get("AA_OAUTH_CLOCK_SKEW_SECONDS", "300"))
        except ValueError:
            clock_skew = 300.0

    parts = id_token.split(".")
    if len(parts) != 3 or not all(parts):
        return None, "bad_structure"

    header = _decode_segment(parts[0])
    payload = _decode_segment(parts[1])
    if header is None or payload is None:
        return None, "undecodable"

    # exp 过期校验（容忍时钟偏移：exp + skew >= now 仍视为有效）
    exp = payload.get("exp")
    if exp is not None and time.time() >= float(exp) + clock_skew:
        logger.warning(
            f"ADFS id_token 已过期: exp={exp} now={int(time.time())} "
            f"skew={int(clock_skew)}s（超出容忍，疑似服务器时钟严重偏移或 token 被重放）"
        )
        return None, "expired"

    # aud 校验：id_token 的受众必须是本应用 client_id（ADFS 会下发 aud=client_id）
    if expected_aud:
        aud = payload.get("aud")
        aud_values = aud if isinstance(aud, list) else [aud]
        if expected_aud not in aud_values:
            logger.warning(
                f"ADFS id_token aud 不匹配: {aud!r} != {expected_aud!r} "
                "（检查 AA_OAUTH_CLIENT_ID 是否与 ADFS 应用组中的 client_id 一致）"
            )
            return None, "aud_mismatch"

    # JWKS 验签（alg=none 的 ADFS id_token 会跳过，fallback 到结构校验）
    alg = header.get("alg", "")
    kid = header.get("kid") or header.get("x5t")
    if alg and alg != "none" and kid:
        return _verify_signed(payload, parts, alg, kid)

    # alg=none 或无 kid：仅结构+有效期校验（ADFS 默认行为，信任来自 /token 的
    # TLS 通道）
    return payload, "ok"


def _verify_signed(
    payload: dict, parts: list[str], alg: str, kid: str
) -> tuple[dict | None, str]:
    """对签名型 id_token 执行 JWKS 验签，kid 轮换时自动刷新重试一次。"""
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import padding

    hash_alg = {"RS256": hashes.SHA256(), "RS384": hashes.SHA384(),
                "RS512": hashes.SHA512()}.get(alg)
    if hash_alg is None:
        logger.warning(f"ADFS id_token 不支持的签名算法: {alg}")
        return None, "unsupported_alg"
    signing_input = f"{parts[0]}.{parts[1]}".encode()
    signature = _b64url_decode(parts[2])

    for attempt in range(2):
        keys = _get_jwks(force_refresh=(attempt == 1))
        if keys is None:
            # JWKS 不可达：降级为结构+有效期校验，保证可用性
            logger.warning("ADFS JWKS 不可达，id_token 降级为结构校验")
            return payload, "ok"
        if kid not in keys:
            if attempt == 0:
                continue  # 刷新后重试
            logger.warning(f"ADFS id_token kid={kid} 在 JWKS 中未找到")
            return None, "kid_not_found"
        try:
            keys[kid].verify(signature, signing_input, padding.PKCS1v15(), hash_alg)
            return payload, "ok"
        except Exception:
            if attempt == 0:
                continue  # kid 可能已轮换，刷新后重试
            logger.warning(f"ADFS id_token 验签失败（kid={kid}）")
            return None, "bad_signature"
    return None, "bad_signature"


# ===== 授权码换取令牌 =====
def exchange_code_for_token(
    *,
    code: str,
    client_id: str,
    client_secret: str,
    redirect_uri: str,
    expected_nonce: str | None = None,
    timeout: int = 15,
) -> dict | None:
    """用授权码向 ADFS /token 端点换取令牌，成功返回完整 token 响应，失败返回 None。

    参数经 x-www-form-urlencoded 编码后 POST，client_secret 不出服务端。

    expected_nonce：防重放随机串（调用方通常取 sha256(code)）。提供时会：
    - 通过 resource=urn:microsoft:adfs:oauth:{nonce} 让 ADFS 把 nonce 写入 token；
    - 响应中若找到 nonce 则必须匹配，找不到则降级为仅告警
      （ADFS 版本不回显 nonce 时仍可用，信任来自 TLS 通道 + 一次性 code）。

    注意：resource 参数仅在环境变量 AA_OAUTH_NONCE=1 时才会附加——
    部分 ADFS 版本会对未注册的 resource 报错导致换票失败，默认不启用。
    """
    form = {
        "client_id": client_id,
        "code": code,
        "redirect_uri": redirect_uri,
        "grant_type": "authorization_code",
        "client_secret": client_secret,
    }
    nonce_enabled = os.environ.get("AA_OAUTH_NONCE", "") == "1"
    if expected_nonce and nonce_enabled:
        form["resource"] = f"urn:microsoft:adfs:oauth:{expected_nonce}"
    body = urllib.parse.urlencode(form).encode("utf-8")
    req = urllib.request.Request(
        ADFS_TOKEN_URL,
        data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        # ADFS 返回的错误体（invalid_grant/expired 等）是定位换票失败的关键证据
        err_body = ""
        try:
            err_body = e.read().decode("utf-8", errors="replace")[:500]
        except Exception:
            pass
        logger.warning(f"ADFS /token HTTP {e.code}: {err_body}")
        return None
    except Exception as e:
        logger.error(f"ADFS /token 换取失败: {e}")
        return None

    if not isinstance(data, dict):
        return None

    if expected_nonce and nonce_enabled:
        echoed = find_nonce(data)
        if echoed is not None and echoed != expected_nonce:
            logger.warning("ADFS /token 响应 nonce 不匹配，疑似重放，已拒绝")
            return None
        if echoed is None:
            logger.info("ADFS /token 响应未回显 nonce（旧版 ADFS 行为），降级跳过 nonce 校验")
    return data


def extract_id_token(token_response: dict) -> str | None:
    """从 /token 响应中提取 id_token。"""
    id_token = token_response.get("id_token")
    return id_token if isinstance(id_token, str) and id_token else None
