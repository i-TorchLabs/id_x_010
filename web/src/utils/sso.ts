import {
    ADFS_AUTHORIZE_URL,
    ADFS_CLIENT_ID,
    ADFS_REDIRECT_URI,
    ADFS_RESOURCE,
} from "@/utils/config";

/** sessionStorage 中暂存 CSRF state 的 key，回调页据此校验 */
export const OAUTH_STATE_KEY = "id_x_010_adfs_oauth_state";

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
