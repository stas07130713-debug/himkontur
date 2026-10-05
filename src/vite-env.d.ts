/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

type HimkonturUpdateStatus = Readonly<{
  state: "idle" | "checking" | "available" | "downloading" | "downloaded" | "current" | "error" | "development" | "installing";
  version?: string;
  percent?: number;
  message?: string;
}>;

// DOM globals require declaration merging; a type alias cannot augment Window.
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
interface Window {
  himkonturUpdates?: Readonly<{
    platform: "windows";
    getVersion: () => Promise<string>;
    getStatus: () => Promise<HimkonturUpdateStatus>;
    check: () => Promise<HimkonturUpdateStatus>;
    install: () => Promise<HimkonturUpdateStatus>;
    onStatus: (callback: (status: HimkonturUpdateStatus) => void) => () => void;
  }>;
}
