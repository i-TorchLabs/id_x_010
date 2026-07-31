"use client";

import { motion } from "framer-motion";

interface LoadingDotsProps {
  size?: "sm" | "md" | "lg";
  color?: string;
}

export function LoadingDots({ size = "md", color }: LoadingDotsProps) {
  const sizeClasses = {
    sm: "w-1.5 h-1.5",
    md: "w-2 h-2",
    lg: "w-2.5 h-2.5",
  };

  const dotClass = `${sizeClasses[size]} rounded-full ${
    color || "bg-current"
  }`;

  return (
    <div className="flex items-center gap-1">
      {[0, 1, 2].map((index) => (
        <motion.span
          key={index}
          className={dotClass}
          animate={{
            opacity: [0.4, 1, 0.4],
            scale: [0.8, 1, 0.8],
          }}
          transition={{
            duration: 1.4,
            repeat: Infinity,
            delay: index * 0.2,
            ease: "easeInOut",
          }}
        />
      ))}
    </div>
  );
}
