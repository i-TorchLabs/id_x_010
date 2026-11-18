import {
    ADFS_AUTHORIZE_URL,
    ADFS_CLIENT_ID,
    ADFS_LOGOUT_URL,
    ADFS_REDIRECT_URI,
    ADFS_RESOURCE,
} from "@/utils/config";

/** sessionStorage 中暂存 CSRF state 的 key，回调页据此校验 */
export const OAUTH_STATE_KEY = "id_x_010_adfs_oauth_state";

/** localStorage 中标记当前会话由 SSO 建立的 key；登出时据此决定是否一并登出 ADFS */
export const SSO_LOGIN_FLAG = "id_x_010_sso_login";

/** 生成 CSRF 防护随机串 */
const genState = (): string => {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
};

/**
 * 跳转到 ADFS 授权页（授权码授予流）。
 * - 生成并暂存 state（sessionStorage），回调页校验防 CSRF；
 * - response_type=code，redirect_uri 必须与 ADFS 注册地址完全一致。
 */
export const redirectToAdfsAuthorize = (): void => {
    if (!ADFS_CLIENT_ID) {
        // 构建期未注入 client_id 时提前报错，避免跳到 ADFS 后才失败（MSIS9220）
        console.error("ADFS_CLIENT_ID not configured, cannot initiate SSO");
        return;
    }
    const state = genState();
    sessionStorage.setItem(OAUTH_STATE_KEY, state);
    const params = new URLSearchParams({
        client_id: ADFS_CLIENT_ID,
        response_type: "code",
        redirect_uri: ADFS_REDIRECT_URI,
        resource: ADFS_RESOURCE,
        state,
    });
    window.location.href = `${ADFS_AUTHORIZE_URL}?${params.toString()}`;
};

/** 标记当前会话由 SSO 建立（SSO 登录成功后调用） */
export const setSsoLoginFlag = (): void => {
    if (typeof window !== "undefined") {
        localStorage.setItem(SSO_LOGIN_FLAG, "1");
    }
};

/** 清除 SSO 会话标记（密码登录 / 登出时调用） */
export const clearSsoLoginFlag = (): void => {
    if (typeof window !== "undefined") {
        localStorage.removeItem(SSO_LOGIN_FLAG);
    }
};

/** 判断当前会话是否由 SSO 建立 */
export const isSsoLogin = (): boolean => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(SSO_LOGIN_FLAG) === "1";
};

/**
 * 后台静默终止 ADFS 单点登录会话（不跳转、不打断用户）。
 *
 * 通过隐藏 iframe 加载 ADFS 登出端点（不带 post_logout_redirect_uri，
 * ADFS 终止会话后仅回写 Sign-Out 状态的空白页，不发生导航跳转）。
 * 页面卸载时 iframe 随之销毁，无论 ADFS 应答与否前端均已回到首页。
 *
 * 注意：个别浏览器（如 Safari 默认屏蔽三方 Cookie）可能无法携带
 * ADFS 会话 Cookie 导致终止失败——此时本站登录态已清除，不影响
 * "退出至首页"的体验；仅 ADFS 侧会话残留，下次 SSO 登录免密登入。
 * 如需确保 ADFS 会话彻底终止，可让用户自行访问 ADFS 登出页。
 */
export const silentAdfsLogout = (): void => {
    if (typeof window === "undefined") return;
    try {
        const iframe = document.createElement("iframe");
        iframe.style.display = "none";
        // sandbox 仅放载入：iframe 无需脚本 / 表单 / 同源权限，
        // 纯粹触发 ADFS Set-Cookie 清除会话
        iframe.setAttribute("sandbox", "");
        iframe.setAttribute("aria-hidden", "true");
        iframe.title = "adfs-silent-logout";
        iframe.src = ADFS_LOGOUT_URL;
        document.body.appendChild(iframe);
        // 兜底清理：60s 后移除 iframe，避免极端情况下节点泄漏
        window.setTimeout(() => iframe.remove(), 60_000);
    } catch (e) {
        // 静默失败不影响主流程（本站登录态已由调用方清除）
        console.warn("silent ADFS logout failed:", e);
    }
};
