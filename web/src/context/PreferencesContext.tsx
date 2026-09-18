import React, { createContext, useContext, useEffect, useState } from "react";

interface PreferencesContextValue {
  darkMode: boolean;
  toggleDarkMode: () => void;
  useZulu: boolean;
  toggleZulu: () => void;
}

const PreferencesContext = createContext<PreferencesContextValue | undefined>(undefined);

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    const stored = localStorage.getItem("aat_dark_mode");
    if (stored != null) return stored === "true";
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true;
  });
  const [useZulu, setUseZulu] = useState<boolean>(() => localStorage.getItem("aat_use_zulu") !== "false");

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
    localStorage.setItem("aat_dark_mode", String(darkMode));
  }, [darkMode]);

  useEffect(() => {
    localStorage.setItem("aat_use_zulu", String(useZulu));
  }, [useZulu]);

  return (
    <PreferencesContext.Provider
      value={{
        darkMode,
        toggleDarkMode: () => setDarkMode((d) => !d),
        useZulu,
        toggleZulu: () => setUseZulu((z) => !z),
      }}
    >
      {children}
    </PreferencesContext.Provider>
  );
}

export function usePreferences() {
  const ctx = useContext(PreferencesContext);
  if (!ctx) throw new Error("usePreferences must be used within PreferencesProvider");
  return ctx;
}
