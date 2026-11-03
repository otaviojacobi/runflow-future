/** The web preview has no phone push (the installed web app has its own Web Push, S7b): everything is a no-op. */
export type PushState = "unsupported" | "unconfigured" | "denied" | "off" | "on";
export const configurePush = () => undefined;
export const pushState = async (): Promise<PushState> => "unsupported";
export const enablePush = async (): Promise<PushState> => "unsupported";
export const disablePush = async (): Promise<PushState> => "unsupported";
export const refreshPush = async () => undefined;
export const forgetPushDevice = async () => undefined;
export const setBadge = (_n: number) => undefined;
