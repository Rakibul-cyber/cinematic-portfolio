"use client";

import { buttonClass } from "@/components/admin/admin-shell";

export function DeleteButton({ children = "Delete" }: { children?: string }) {
  return (
    <button
      className={buttonClass}
      onClick={(event) => {
        if (!window.confirm("Delete this item? This cannot be undone."))
          event.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
