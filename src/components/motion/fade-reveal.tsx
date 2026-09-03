"use client";

import type { ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";

import { MOTION_EASE } from "@/lib/constants";
import { cn } from "@/lib/utils";

type FadeRevealProps = {
  children: ReactNode;
  className?: string;
  delay?: number;
};

export function FadeReveal({ children, className, delay = 0 }: FadeRevealProps) {
  const prefersReducedMotion = useReducedMotion();

  return (
    <motion.div
      className={cn(className)}
      initial={prefersReducedMotion ? false : { y: 20 }}
      transition={{ duration: 0.7, delay, ease: MOTION_EASE }}
      viewport={{ once: true, amount: 0.18 }}
      whileInView={prefersReducedMotion ? undefined : { y: 0 }}
    >
      {children}
    </motion.div>
  );
}
