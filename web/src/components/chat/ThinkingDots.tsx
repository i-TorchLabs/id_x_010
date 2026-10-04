"use client";

import { useTheme } from "@/context/ThemeContext";
import { motion, AnimatePresence } from "framer-motion";

interface ThinkingDotsProps {
  visible?: boolean;
  label?: string;
}

export function ThinkingDots({
  visible = true,
  label = "Running",
}: ThinkingDotsProps) {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: -3, height: 0 }}
          animate={{ opacity: 1, y: 0, height: "auto" }}
          exit={{ opacity: 0, y: -3, height: 0 }}
          transition={{ duration: 0.25, ease: "easeInOut" }}
          className="flex items-center gap-2 mt-3"
          style={{ paddingLeft: "8px" }}
        >
          {/* Three animated dots */}
          <div className="flex items-center gap-1.25">
            {[0, 1, 2].map((i) => (
              <motion.div
                key={i}
                animate={{
                  y: [0, -3, 0],
                  scale: [1, 1.15, 1],
                  opacity: [0.45, 1, 0.45],
                }}
                transition={{
                  duration: 1.2,
                  repeat: Infinity,
                  delay: i * 0.2,
                  ease: "easeInOut",
                }}
                className="rounded-full"
                style={{
                  width: 7,
                  height: 7,
                  background: isDark
                    ? "rgba(255,255,255,0.55)"
                    : "rgba(0,0,0,0.45)",
                }}
              />
            ))}
          </div>

          {/* Label text */}
          <motion.span
            animate={{ opacity: [0.5, 1, 0.5] }}
            transition={{
              duration: 2,
              repeat: Infinity,
              ease: "easeInOut",
            }}
            className={`text-[12px] font-medium tracking-wide ${
              isDark ? "text-[rgba(255,255,255,0.5)]" : "text-[rgba(0,0,0,0.4)]"
            }`}
            style={{
              fontFamily:
                "SF Pro Text, -apple-system, BlinkMacSystemFont, sans-serif",
            }}
          >
            {label}
          </motion.span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
