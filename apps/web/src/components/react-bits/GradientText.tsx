import React from "react";
import "./GradientText.css";

type GradientTextProps = {
  children: React.ReactNode;
  className?: string;
  colors?: string[];
  animationSpeed?: number;
  direction?: "horizontal" | "vertical" | "diagonal";
  pauseOnHover?: boolean;
  showBorder?: boolean;
};

export default function GradientText({
  children,
  className = "",
  colors = ["#ee2e24", "#1f1a17", "#f7f7f7", "#ee2e24"],
  animationSpeed = 5,
  direction = "horizontal",
  pauseOnHover = false,
  showBorder = false
}: GradientTextProps) {
  const angle = direction === "vertical" ? "to bottom" : direction === "diagonal" ? "to bottom right" : "to right";
  const gradientColors = [...colors, colors[0]].join(", ");
  const style = {
    "--gradient-angle": angle,
    "--gradient-colors": gradientColors,
    "--gradient-speed": `${animationSpeed}s`
  } as React.CSSProperties;
  return (
    <span
      className={`animated-gradient-text ${showBorder ? "with-border" : ""} ${pauseOnHover ? "pause-on-hover" : ""} ${className}`}
      style={style}
    >
      {showBorder ? <span className="gradient-overlay" aria-hidden="true" /> : null}
      <span className="text-content">{children}</span>
    </span>
  );
}
