"use client";

import { buttonClass } from "@/components/admin/admin-styles";

/**
 * A confirmed delete. `itemName` names the record for assistive technology
 * when the same button repeats down a list ("Delete image and all variants:
 * fixture-image-1.jpg"); the visible text is unchanged.
 */
export function DeleteButton({ children = "Delete", itemName }: { children?: string; itemName?: string }) {
  return (
    <button
      className={buttonClass}
      onClick={(event) => {
        if (!window.confirm("Delete this item? This cannot be undone."))
          event.preventDefault();
      }}
    >
      {children}
      {itemName ? <span className="sr-only">: {itemName}</span> : null}
    </button>
  );
}
