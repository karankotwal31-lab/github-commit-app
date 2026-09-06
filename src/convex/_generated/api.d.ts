/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 * To regenerate from a configured Convex deployment, run `bunx convex codegen`.
 * @module
 */

import type * as aiActions from "../aiActions.js";
import type * as aiConversations from "../aiConversations.js";
import type * as aiFindings from "../aiFindings.js";
import type * as aiFindingsStore from "../aiFindingsStore.js";
import type * as aiStatus from "../aiStatus.js";
import type * as aiUsage from "../aiUsage.js";
import type * as analytics from "../analytics.js";
import type * as auth from "../auth.js";
import type * as billing from "../billing.js";
import type * as billingActions from "../billingActions.js";
import type * as cli from "../cli.js";
import type * as deployments from "../deployments.js";
import type * as diagnostics from "../diagnostics.js";
import type * as email from "../email.js";
import type * as engineering from "../engineering.js";
import type * as errorReporting from "../errorReporting.js";
import type * as github from "../github.js";
import type * as githubActions from "../githubActions.js";
import type * as health from "../health.js";
import type * as notifications from "../notifications.js";
import type * as organizations from "../organizations.js";
import type * as plugins from "../plugins.js";
import type * as pushSubscriptions from "../pushSubscriptions.js";
import type * as security from "../security.js";
import type * as securityCenter from "../securityCenter.js";
import type * as securityHardening from "../securityHardening.js";
import type * as securityScanner from "../securityScanner.js";
import type * as stripeEvents from "../stripeEvents.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  AnyComponents,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  aiActions: typeof aiActions;
  aiConversations: typeof aiConversations;
  aiFindings: typeof aiFindings;
  aiFindingsStore: typeof aiFindingsStore;
  aiStatus: typeof aiStatus;
  aiUsage: typeof aiUsage;
  analytics: typeof analytics;
  auth: typeof auth;
  billing: typeof billing;
  billingActions: typeof billingActions;
  cli: typeof cli;
  deployments: typeof deployments;
  diagnostics: typeof diagnostics;
  email: typeof email;
  engineering: typeof engineering;
  errorReporting: typeof errorReporting;
  github: typeof github;
  githubActions: typeof githubActions;
  health: typeof health;
  notifications: typeof notifications;
  organizations: typeof organizations;
  plugins: typeof plugins;
  pushSubscriptions: typeof pushSubscriptions;
  security: typeof security;
  securityCenter: typeof securityCenter;
  securityHardening: typeof securityHardening;
  securityScanner: typeof securityScanner;
  stripeEvents: typeof stripeEvents;
  users: typeof users;
}>;

export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

/** Installed Convex component references are generated dynamically at runtime. */
export declare const components: AnyComponents;
