import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";

import { useAuth } from "@/hooks/use-auth";
import { ArrowRight, Loader2, Music2 } from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

interface AuthProps {
  redirectAfterAuth?: string;
}

function resolveRedirectAfterAuth(
  returnTo: string | null,
  fallback = "/dashboard",
) {
  if (returnTo?.startsWith("/") && !returnTo.startsWith("//")) {
    return returnTo;
  }
  return fallback;
}

function Auth({ redirectAfterAuth }: AuthProps = {}) {
  const { isLoading: authLoading, isAuthenticated, signIn } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirect = resolveRedirectAfterAuth(
    searchParams.get("returnTo"),
    redirectAfterAuth,
  );
  const [step, setStep] = useState<"signIn" | { email: string }>("signIn");
  const [otp, setOtp] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      navigate(redirect);
    }
  }, [authLoading, isAuthenticated, navigate, redirect]);

  const handleEmailSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      const formData = new FormData(event.currentTarget);
      await signIn("email-otp", formData);
      setStep({ email: formData.get("email") as string });
      setIsLoading(false);
    } catch (error) {
      console.error("Email sign-in error:", error);
      setError(
        error instanceof Error
          ? error.message
          : "Failed to send verification code. Please try again.",
      );
      setIsLoading(false);
    }
  };

  const handleOtpSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      const formData = new FormData(event.currentTarget);
      await signIn("email-otp", formData);
      navigate(redirect);
    } catch (error) {
      console.error("OTP verification error:", error);
      setError("The verification code you entered is incorrect.");
      setIsLoading(false);
      setOtp("");
    }
  };

  const handleGuestLogin = async () => {
    setIsLoading(true);
    setError(null);
    try {
      await signIn("anonymous");
      navigate(redirect);
    } catch (error) {
      console.error("Guest login error:", error);
      setError(
        `Failed to sign in as guest: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground antialiased">
      <header className="flex h-16 items-center justify-between border-b border-neutral-200 px-6">
        <Link to="/" className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
            <Music2 className="size-3.5" strokeWidth={2.4} />
          </span>
          <span className="text-[15px] font-semibold tracking-tight">
            Aria<span className="text-neutral-400">.</span>
          </span>
        </Link>
        <p className="text-xs text-neutral-400">Personal GitHub desk</p>
      </header>

      <main className="flex flex-1 items-center justify-center px-6 py-16">
        <div className="w-full max-w-sm rounded-xl border border-neutral-200 bg-white p-8 shadow-[0_16px_48px_-24px_rgba(0,0,0,0.12)]">
          {step === "signIn" ? (
            <>
              <div className="mb-8 text-center">
                <h1 className="text-2xl font-semibold tracking-tight">
                  Get started
                </h1>
                <p className="mt-2 text-[15px] text-neutral-500">
                  Enter your email to log in or sign up.
                </p>
              </div>

              <form onSubmit={handleEmailSubmit} className="space-y-4">
                <Input
                  name="email"
                  placeholder="name@example.com"
                  type="email"
                  className="h-10"
                  disabled={isLoading}
                  required
                />
                {error && <p className="text-sm text-red-600">{error}</p>}
                <Button
                  type="submit"
                  className="h-10 w-full"
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <>
                      Continue
                      <ArrowRight className="size-4" />
                    </>
                  )}
                </Button>
              </form>

              <div className="my-6 flex items-center gap-3">
                <span className="h-px flex-1 bg-neutral-200" />
                <span className="text-xs uppercase tracking-widest text-neutral-400">
                  Or
                </span>
                <span className="h-px flex-1 bg-neutral-200" />
              </div>

              <Button
                type="button"
                variant="outline"
                className="h-10 w-full"
                onClick={handleGuestLogin}
                disabled={isLoading}
              >
                Continue as guest
              </Button>

              <p className="mt-6 rounded-lg border border-neutral-100 bg-neutral-50/60 px-3 py-2.5 text-xs leading-5 text-neutral-500">
                Next: you&apos;ll connect GitHub once, then pick a repo and a
                branch. Your token stays server-side.
              </p>
            </>
          ) : (
            <>
              <div className="mb-8 text-center">
                <h1 className="text-2xl font-semibold tracking-tight">
                  Check your email
                </h1>
                <p className="mt-2 text-[15px] text-neutral-500">
                  We sent a code to <span className="text-neutral-900">{step.email}</span>
                </p>
              </div>

              <form onSubmit={handleOtpSubmit} className="space-y-6">
                <input type="hidden" name="email" value={step.email} />
                <input type="hidden" name="code" value={otp} />

                <div className="flex justify-center">
                  <InputOTP
                    value={otp}
                    onChange={setOtp}
                    maxLength={6}
                    disabled={isLoading}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && otp.length === 6 && !isLoading) {
                        const form = (e.target as HTMLElement).closest("form");
                        if (form) form.requestSubmit();
                      }
                    }}
                  >
                    <InputOTPGroup>
                      {Array.from({ length: 6 }).map((_, index) => (
                        <InputOTPSlot key={index} index={index} />
                      ))}
                    </InputOTPGroup>
                  </InputOTP>
                </div>

                {error && (
                  <p className="text-center text-sm text-red-600">{error}</p>
                )}

                <Button
                  type="submit"
                  className="h-10 w-full"
                  disabled={isLoading || otp.length !== 6}
                >
                  {isLoading ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <>
                      Verify code
                      <ArrowRight className="size-4" />
                    </>
                  )}
                </Button>

                <p className="text-center text-sm text-neutral-500">
                  Didn't receive a code?{" "}
                  <button
                    type="button"
                    className="font-medium text-neutral-900 underline underline-offset-4"
                    onClick={() => setStep("signIn")}
                    disabled={isLoading}
                  >
                    Try again
                  </button>
                </p>
              </form>
            </>
          )}

          <p className="mt-8 border-t border-neutral-100 pt-6 text-center text-xs text-neutral-400">
            Secured by{" "}
            <a
              href="https://freebuff.com"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:text-neutral-600"
            >
              freebuff.com
            </a>
          </p>
        </div>
      </main>
    </div>
  );
}

export default function AuthPage(props: AuthProps) {
  return (
    <Suspense>
      <Auth {...props} />
    </Suspense>
  );
}
