"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Script from "next/script";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { ErrorMessage } from "@/components/ui";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (options: {
            client_id: string;
            callback: (response: { credential: string }) => void;
          }) => void;
          renderButton: (element: HTMLElement, options: Record<string, string | number>) => void;
        };
      };
    };
  }
}

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

export default function SignInPage() {
  const router = useRouter();
  const { signIn, googleSignIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleScriptLoaded, setGoogleScriptLoaded] = useState(false);
  const [googleButtonReady, setGoogleButtonReady] = useState(false);
  const [googleError, setGoogleError] = useState("");
  const googleButtonRef = useRef<HTMLDivElement>(null);
  const googleInitializedRef = useRef(false);
  const [wrongOrigin, setWrongOrigin] = useState(false);

  useEffect(() => {
    // Google only accepts origins registered for the OAuth client (localhost here).
    setWrongOrigin(window.location.hostname === "127.0.0.1");
    // next/script fires onLoad only on the first load; when the script is already
    // present (client-side navigation back to this page) start from window.google.
    if (window.google?.accounts?.id) setGoogleScriptLoaded(true);
  }, []);

  const handleGoogleCredential = useCallback(async (response: { credential: string }) => {
    if (!response.credential) {
      setError("Google did not return a sign-in credential. Please try again.");
      return;
    }
    setError("");
    setGoogleLoading(true);
    try {
      await googleSignIn(response.credential);
      router.push("/dashboard");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Google sign-in failed.");
    } finally {
      setGoogleLoading(false);
    }
  }, [googleSignIn, router]);

  useEffect(() => {
    if (!googleScriptLoaded || !GOOGLE_CLIENT_ID || !googleButtonRef.current || googleInitializedRef.current) return;
    if (!window.google) {
      setGoogleError("Google sign-in loaded without its identity service. Reload the page or use email and password.");
      return;
    }
    try {
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: (response) => void handleGoogleCredential(response),
      });
      window.google.accounts.id.renderButton(googleButtonRef.current, {
        theme: "outline",
        size: "large",
        shape: "rect",
        text: "signin_with",
        width: 320,
      });
      googleInitializedRef.current = true;
      setGoogleButtonReady(true);
      setGoogleError("");
    } catch {
      setGoogleError("Google sign-in could not initialize. Reload the page or use email and password.");
    }
  }, [googleScriptLoaded, handleGoogleCredential]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await signIn(email, password);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign‑in failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-card">
        <div className="eyebrow">Welcome back</div>
        <h1>Sign in</h1>
        <p className="muted">Access your private assessment history and clinical reports.</p>
        {GOOGLE_CLIENT_ID && <Script
          src="https://accounts.google.com/gsi/client"
          strategy="afterInteractive"
          onReady={() => setGoogleScriptLoaded(true)}
          onError={() => setGoogleError("Google sign-in could not load. Check your connection or use email and password.")}
        />}
        {error && <ErrorMessage>{error}</ErrorMessage>}
        <form onSubmit={handleSubmit} className="form-stack">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@example.org"
            required
          />

          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            required
          />

          <button className="button button-full" type="submit" disabled={submitting}>
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <div className="auth-divider"><span>or continue with Google</span></div>
        {GOOGLE_CLIENT_ID && wrongOrigin && <p className="google-origin-note" role="status">
          Google sign-in needs the address registered with Google. Open{" "}
          <a href={typeof window === "undefined" ? "#" : window.location.href.replace("//127.0.0.1", "//localhost")}>this page on localhost</a> instead.
        </p>}
        {GOOGLE_CLIENT_ID
          ? <div className="google-login" aria-label="Google sign-in">
              <div ref={googleButtonRef} />
              {!googleButtonReady && !googleError && <p className="google-button-status" role="status">{googleScriptLoaded ? "Connecting to Google…" : "Loading Google sign-in…"}</p>}
              {googleError && <p className="google-button-error" role="alert">{googleError}</p>}
              {googleLoading && <span role="status">Signing in with Google…</span>}
            </div>
          : <p className="provider-note">Google sign-in is not configured. Set matching Google client IDs for the web app and API to enable it.</p>}
        <p className="auth-switch">
          Don’t have an account? <Link href="/register">Create an account</Link>
        </p>
      </div>
    </main>
  );
}
