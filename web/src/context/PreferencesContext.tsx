import React, { createContext, useContext, useEffect, useState } from "react";

interface PreferencesContextValue {
  useZulu: boolean;
  toggleZulu: () => void;
}

const PreferencesContext = createContext<PreferencesContextValue | undefined>(undefined);

// Dark mode is the only theme this application has (Revision Directive v3.0
// Section 1.7) - there is no toggle, no stored preference, and no
// prefers-color-scheme handling. The `dark` class is set once in
// index.html and never changes.
export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const [useZulu, setUseZulu] = useState<boolean>(() => localStorage.getItem("aat_use_zulu") !== "false");

  useEffect(() => {
    localStorage.setItem("aat_use_zulu", String(useZulu));
  }, [useZulu]);

  return (
    <PreferencesContext.Provider value={{ useZulu, toggleZulu: () => setUseZulu((z) => !z) }}>
      {children}
    </PreferencesContext.Provider>
  );
}

export function usePreferences() {
  const ctx = useContext(PreferencesContext);
  if (!ctx) throw new Error("usePreferences must be used within PreferencesProvider");
  return ctx;
}
