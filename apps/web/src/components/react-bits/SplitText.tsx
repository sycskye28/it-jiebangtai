import React, { useEffect, useMemo, useRef } from "react";
import { gsap } from "gsap";

type SplitTextProps = {
  text: string;
  className?: string;
  delay?: number;
  duration?: number;
  ease?: string;
  splitType?: "chars" | "words" | "lines" | "words, chars";
  from?: gsap.TweenVars;
  to?: gsap.TweenVars;
  threshold?: number;
  rootMargin?: string;
  textAlign?: React.CSSProperties["textAlign"];
  tag?: keyof JSX.IntrinsicElements;
  onLetterAnimationComplete?: () => void;
};

export default function SplitText({
  text,
  className = "",
  delay = 50,
  duration = 1.25,
  ease = "power3.out",
  splitType = "chars",
  from = { opacity: 0, y: 40 },
  to = { opacity: 1, y: 0 },
  threshold = 0.1,
  rootMargin = "-100px",
  textAlign = "center",
  tag = "p",
  onLetterAnimationComplete
}: SplitTextProps) {
  const ref = useRef<HTMLElement | null>(null);
  const completedRef = useRef(false);
  const parts = useMemo(() => {
    if (splitType.includes("words") && !splitType.includes("chars")) {
      return text.split(/(\s+)/).map((part, index) => ({ key: `${part}-${index}`, text: part, space: /^\s+$/.test(part) }));
    }
    return Array.from(text).map((part, index) => ({ key: `${part}-${index}`, text: part, space: part === " " }));
  }, [splitType, text]);

  useEffect(() => {
    const element = ref.current;
    if (!element || !text || completedRef.current) return;
    const targets = element.querySelectorAll<HTMLElement>("[data-split-part]");
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      gsap.fromTo(
        targets,
        from,
        {
          ...to,
          duration,
          ease,
          stagger: delay / 1000,
          onComplete: () => {
            completedRef.current = true;
            onLetterAnimationComplete?.();
          }
        }
      );
    }, { threshold, rootMargin });
    observer.observe(element);
    return () => observer.disconnect();
  }, [delay, duration, ease, from, onLetterAnimationComplete, rootMargin, text, threshold, to]);

  const Tag = tag as React.ElementType;
  return (
    <Tag
      ref={ref}
      className={`split-parent ${className}`}
      style={{ textAlign, overflow: "hidden", display: "inline-block", whiteSpace: "normal", wordWrap: "break-word" }}
    >
      {parts.map((part) => (
        <span className="split-part" data-split-part key={part.key}>
          {part.space ? "\u00a0" : part.text}
        </span>
      ))}
    </Tag>
  );
}
