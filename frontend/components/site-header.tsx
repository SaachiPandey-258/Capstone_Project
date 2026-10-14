"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { useState } from "react";

const publicLinks = [
  ["/about", "About"],
  ["/how-it-works", "How it works"],
  ["/resources", "Resources"],
];
const privateLinks = [
  ["/dashboard", "Overview"],
  ["/assessment/new", "New assessment"],
  ["/assessments", "My assessments"],
  ["/reports", "Reports"],
  ["/analytics", "Analytics"],
  ["/specialists", "Find care"],
];

export function SiteHeader() {
  const { user, signOut } = useAuth();
  const pathname = usePathname();
  const [signOutError, setSignOutError] = useState("");
  const links = user ? privateLinks : publicLinks;
  async function handleSignOut() {
    setSignOutError("");
    try {
      await signOut();
    } catch (error) {
      setSignOutError(error instanceof Error ? `${error.message} Your local session was cleared.` : "The server could not end the session. Your local session was cleared.");
    }
  }
  return (
    <header className="site-header">
      <div className="header-inner">
        <Link className="brand" href={user ? "/dashboard" : "/"} aria-label="Morrow home">
          <span className="brand-mark" aria-hidden="true">m</span>
          <span>morrow<span className="brand-period">.</span></span>
        </Link>
        <nav className="main-nav" aria-label="Main navigation">
          {links.map(([href, label]) => {
            const active = pathname === href || (href !== "/" && pathname.startsWith(`${href}/`));
            return (
              <Link
                aria-current={active ? "page" : undefined}
                className={active ? "nav-link active" : "nav-link"}
                href={href}
                key={href}
              >
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="header-actions">
          {user ? (
            <>
              <span className="user-greeting">Hi, {user.name.split(" ")[0]}</span>
              <button className="button button-small button-outline" onClick={() => void handleSignOut()}>Sign out</button>
            </>
          ) : (
            <>
              <Link className="nav-link signin-link" href="/signin">Sign in</Link>
              <Link className="button button-small" href="/register">Create account</Link>
            </>
          )}
        </div>
      </div>
      {signOutError && <div className="header-error" role="alert">{signOutError}</div>}
    </header>
  );
}
