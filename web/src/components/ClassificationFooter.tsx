import React from "react";

// Revision Directive v3.0 Section 2.3 - persistent, always-visible (not
// scrollable away) on every authenticated page.
export default function ClassificationFooter() {
  return (
    <footer className="shrink-0 border-t border-zinc-800 bg-black px-4 py-1.5 text-center">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
        ITAR-Controlled // Distribution Is Limited — U.S. Persons Only — See 22 CFR Parts 120–130
      </p>
      <p className="normal-case text-[9px] leading-tight text-zinc-600">
        The information contained herein is the sole and exclusive property of American Aerospace Technologies Corp. Any reproduction,
        distribution, or disclosure of this information, in whole or in part, without the express written permission of American Aerospace
        Technologies Corp is strictly prohibited. Access to this system is limited solely to employees and authorized agents of the Launch
        Operations Division of American Aerospace Technologies Corp.
      </p>
    </footer>
  );
}
