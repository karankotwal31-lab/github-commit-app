/* eslint-disable */
  /**
   * Generated `api` utility.
   *
   * THIS CODE IS AUTOMATICALLY GENERATED.
   *
   * To regenerate, run `npx convex dev`.
   * @module
   */
  
  import type { ApiFromModules, FilterApi, FunctionReference } from "convex/server";
  import type * as aiActions from "../aiActions.js";
import type * as aiConversations from "../aiConversations.js";
import type * as aiFindings from "../aiFindings.js";
import type * as aiFindingsStore from "../aiFindingsStore.js";
import type * as aiProvider from "../aiProvider.js";
import type * as aiStatus from "../aiStatus.js";
import type * as aiUsage from "../aiUsage.js";
import type * as analytics from "../analytics.js";
import type * as auth from "../auth.js";
import type * as billing from "../billing.js";
import type * as billingActions from "../billingActions.js";
import type * as billingConfig from "../billingConfig.js";
import type * as cli from "../cli.js";
import type * as crons from "../crons.js";
import type * as deployments from "../deployments.js";
import type * as diagnostics from "../diagnostics.js";
import type * as email from "../email.js";
import type * as engineering from "../engineering.js";
import type * as errorReporting from "../errorReporting.js";
import type * as github from "../github.js";
import type * as githubActions from "../githubActions.js";
import type * as health from "../health.js";
import type * as http from "../http.js";
import type * as net from "../net.js";
import type * as notifications from "../notifications.js";
import type * as organizations from "../organizations.js";
import type * as plugins from "../plugins.js";
import type * as pushSubscriptions from "../pushSubscriptions.js";
import type * as security from "../security.js";
import type * as securityCenter from "../securityCenter.js";
import type * as securityHardening from "../securityHardening.js";
import type * as securityScanner from "../securityScanner.js";
import type * as sha256 from "../sha256.js";
import type * as stripeEvents from "../stripeEvents.js";
import type * as stripeWebhook from "../stripeWebhook.js";
import type * as users from "../users.js";

  /**
   * A utility for referencing Convex functions in your app's API.
   *
   * Usage:
   * ```js
   * const myFunctionReference = api.myModule.myFunction;
   * ```
   */
  declare const fullApi: ApiFromModules<{
    "aiActions": typeof aiActions,
"aiConversations": typeof aiConversations,
"aiFindings": typeof aiFindings,
"aiFindingsStore": typeof aiFindingsStore,
"aiProvider": typeof aiProvider,
"aiStatus": typeof aiStatus,
"aiUsage": typeof aiUsage,
"analytics": typeof analytics,
"auth": typeof auth,
"billing": typeof billing,
"billingActions": typeof billingActions,
"billingConfig": typeof billingConfig,
"cli": typeof cli,
"crons": typeof crons,
"deployments": typeof deployments,
"diagnostics": typeof diagnostics,
"email": typeof email,
"engineering": typeof engineering,
"errorReporting": typeof errorReporting,
"github": typeof github,
"githubActions": typeof githubActions,
"health": typeof health,
"http": typeof http,
"net": typeof net,
"notifications": typeof notifications,
"organizations": typeof organizations,
"plugins": typeof plugins,
"pushSubscriptions": typeof pushSubscriptions,
"security": typeof security,
"securityCenter": typeof securityCenter,
"securityHardening": typeof securityHardening,
"securityScanner": typeof securityScanner,
"sha256": typeof sha256,
"stripeEvents": typeof stripeEvents,
"stripeWebhook": typeof stripeWebhook,
"users": typeof users,
  }>;
  export declare const api: FilterApi<typeof fullApi, FunctionReference<any, "public">>;
  export declare const internal: FilterApi<typeof fullApi, FunctionReference<any, "internal">>;
  
export declare const components: { staticHosting: import("@convex-dev/static-hosting/_generated/component.js").ComponentApi<"staticHosting"> };
