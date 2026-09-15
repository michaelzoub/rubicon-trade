export function RubiconBrand({
  className = "h-7",
  onLight = false,
  src = "/RUBICONLOGO.svg",
}: {
  className?: string;
  onLight?: boolean;
  src?: string;
}) {
  const isHeaderBrand = className.includes("site-header-brand");
  return (
    <span
      className={`rubicon-brand${isHeaderBrand ? "" : " inline-flex"} shrink-0 items-center${onLight ? " rubicon-brand--on-light" : ""} ${className}`}
      aria-label="Rubicon"
    >
      <img
        src={src}
        alt=""
        className={isHeaderBrand ? "rubicon-brand-mark" : "rubicon-brand-mark h-full w-auto max-w-full"}
        decoding="async"
      />
    </span>
  );
}
