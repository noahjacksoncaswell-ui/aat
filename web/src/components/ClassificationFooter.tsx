import React from "react";

// Revision Directive v3.0 Section 2.3 - persistent, always-visible (not
// scrollable away) on every authenticated page. `compact` (v5.1 Section 3)
// drops the long proprietary paragraph and shrinks padding, for the Range
// Ops Display page's minimized-chrome design intent - the required notice
// stays present but consumes minimal screen space.
export default function ClassificationFooter({ compact }: { compact?: boolean } = {}) {
  return (
    <footer className={`shrink-0 border-t border-zinc-800 bg-black text-center ${compact ? "px-4 py-0.5" : "px-4 py-1.5"}`}>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
        ITAR-Controlled // Distribution Is Limited — U.S. Persons Only — See 22 CFR Parts 120–130
      </p>
      {!compact && (
        <p className="normal-case text-[9px] leading-tight text-zinc-600">
          The information contained herein is the sole and exclusive property of American Aerospace Technologies Corp. Any reproduction,
          distribution, or disclosure of this information, in whole or in part, without the express written permission of American Aerospace
          Technologies Corp is strictly prohibited. Access to this system is limited solely to employees and authorized agents of the Launch
          Operations Division of American Aerospace Technologies Corp.
        </p>
      )}
    </footer>
  );
}
