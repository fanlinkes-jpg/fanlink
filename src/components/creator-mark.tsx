import { useState } from "react";

/** Foto de OnlyFans o, si falta o no carga, la inicial de siempre. */
export function CreatorMark({
  name,
  hue,
  avatarUrl,
  size = "sm",
}: {
  name: string;
  hue: number;
  avatarUrl?: string | null;
  size?: "sm" | "md" | "lg";
}) {
  const [failed, setFailed] = useState(false);
  const box = size === "lg" ? "h-9 w-9 text-sm" : size === "md" ? "h-7 w-7 text-xs" : "h-5 w-5 text-[10px]";
  if (avatarUrl && !failed) {
    return (
      <img
        src={avatarUrl}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className={`${box} shrink-0 rounded-full object-cover`}
      />
    );
  }
  return (
    <span className={`grid ${box} shrink-0 place-items-center rounded-full font-semibold text-white`} style={{ background: `hsl(${hue} 55% 42%)` }}>
      {name.slice(0, 1)}
    </span>
  );
}
