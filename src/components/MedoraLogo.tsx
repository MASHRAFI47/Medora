import Link from "next/link";

export function MedoraIcon({ size = 34 }: { size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#14B8A6] to-[#0B7A7E] shadow-sm"
      style={{
        width: size,
        height: size,
        transform: "rotate(45deg)",
        borderRadius: Math.round(size * 0.28),
      }}
      aria-hidden="true"
    >
      <svg
        width={Math.round(size * 0.48)}
        height={Math.round(size * 0.48)}
        viewBox="0 0 24 24"
        fill="none"
        stroke="white"
        strokeWidth="3"
        strokeLinecap="round"
        style={{ transform: "rotate(-45deg)" }}
      >
        <path d="M12 5v14M5 12h14" />
      </svg>
    </span>
  );
}

export function MedoraLogo({
  href = "/",
  inverted = false,
}: {
  href?: string;
  inverted?: boolean;
}) {
  return (
    <Link href={href} className="inline-flex items-center gap-3 group">
      <MedoraIcon size={32} />
      <span
        className={`text-xl font-bold tracking-tight transition-colors ${
          inverted
            ? "text-white group-hover:text-medora-teal-light"
            : "text-medora-navy group-hover:text-medora-teal"
        }`}
      >
        Medora
      </span>
    </Link>
  );
}
