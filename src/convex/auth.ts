// THIS FILE IS READ ONLY. Do not touch this file unless you are correctly adding a new auth provider in accordance to the vly auth documentation

import { convexAuth } from "@convex-dev/auth/server";
import { Anonymous } from "@convex-dev/auth/providers/Anonymous";
import { emailOtp } from "./auth/emailOtp";


const authImpl = convexAuth({
  providers: [emailOtp, Anonymous],
});

// Keep the provider-generated actions intact.  Convex Auth's sign-in action
// carries internal state that must not be reimplemented or wrapped here.
export const { auth, signIn, signOut, store, isAuthenticated } = authImpl;
