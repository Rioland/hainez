"use client";

import { createAuthClient } from "better-auth/react";

// No baseURL: calls go to /api/auth on the current (platform) host.
export const authClient = createAuthClient();
