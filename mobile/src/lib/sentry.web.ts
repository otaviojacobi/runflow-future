/** The web preview reports nothing (the product is Android/iOS; the web app has its own Sentry). */
import type { ComponentType } from "react";

export const withErrorReporting = (C: ComponentType): ComponentType => C;
