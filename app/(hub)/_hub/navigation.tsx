"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ComponentProps } from "react";

export function previewHref(href: string): string {
  const views: Record<string, string> = { "/thesis": "thesis", "/": "home", "/explore": "explore", "/trade": "explore", "/activity": "activity", "/agents": "agents", "/profile": "profile", "/plans": "plans" };
  if (views[href]) return `/preview?view=${views[href]}`;
  const asset = href.match(/^\/explore\/(stock|crypto)\/(.+)$/);
  if (asset) return `/preview?view=asset&kind=${asset[1]}&id=${encodeURIComponent(decodeURIComponent(asset[2]))}`;
  return href;
}

export function useHubRouter() {
  const router = useRouter();
  const preview = usePathname() === "/preview";
  return { ...router, push: (href: string) => router.push(preview ? previewHref(href) : href) };
}

export function HubLink({ href, ...props }: ComponentProps<typeof Link>) {
  const preview = usePathname() === "/preview";
  return <Link {...props} href={preview && typeof href === "string" ? previewHref(href) : href} />;
}
