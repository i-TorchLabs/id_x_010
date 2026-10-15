import {
    ADFS_AUTHORIZE_URL,
    ADFS_CLIENT_ID,
    ADFS_LOGOUT_URL,
    ADFS_POST_LOGOUT_REDIRECT_URI,
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
 * 跳转到 ADFS 登出端点，终止 ADFS 单点登录会话。
 * 登出完成后 ADFS 回跳到 post_logout_redirect_uri（用户登录页）。
 *
 * 调用前应已清除本地 token / user / SSO 标记，避免回跳时残留登录态。
 */
export const redirectToAdfsLogout = (): void => {
    const params = new URLSearchParams({
        post_logout_redirect_uri: ADFS_POST_LOGOUT_REDIRECT_URI,
    });
    window.location.href = `${ADFS_LOGOUT_URL}?${params.toString()}`;
};
