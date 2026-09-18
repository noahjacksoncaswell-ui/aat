import React from "react";

type Tone = "go" | "caution" | "nogo" | "neutral";

const toneClass: Record<Tone, string> = {
  go: "status-go",
  caution: "status-caution",
  nogo: "status-nogo",
  neutral: "status-neutral",
};

export function StatusPill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <span className={`status-pill ${toneClass[tone]}`}>{children}</span>;
}

export function missionStatusTone(status: string): Tone {
  switch (status) {
    case "TARGETED":
      return "caution";
    case "SUCCESSFUL":
      return "go";
    case "SCRUBBED":
    case "CANCELLED":
      return "nogo";
    default:
      return "neutral";
  }
}

export function coaStatusTone(status: string): Tone {
  switch (status) {
    case "ACTIVE":
      return "go";
    case "PENDING":
      return "caution";
    case "EXPIRED":
    case "NOT_ON_FILE":
      return "nogo";
    default:
      return "neutral";
  }
}

export function goNoGoTone(status: string): Tone {
  switch (status) {
    case "GO":
      return "go";
    case "HOLD":
      return "caution";
    case "NO_GO":
      return "nogo";
    default:
      return "neutral";
  }
}

export function weatherStatusTone(status: string): Tone {
  switch (status) {
    case "GO":
      return "go";
    case "CAUTION":
      return "caution";
    case "NO_GO":
      return "nogo";
    default:
      return "neutral";
  }
}
