import React, { ElementType, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { gsap } from "gsap";
import "./TextType.css";

type TextTypeProps = {
  text: string | string[];
  as?: ElementType;
  typingSpeed?: number;
  initialDelay?: number;
  pauseDuration?: number;
  deletingSpeed?: number;
  loop?: boolean;
  className?: string;
  showCursor?: boolean;
  hideCursorWhileTyping?: boolean;
  cursorCharacter?: React.ReactNode;
  cursorClassName?: string;
  cursorBlinkDuration?: number;
  textColors?: string[];
  variableSpeed?: { min: number; max: number };
  onSentenceComplete?: (sentence: string, index: number) => void;
  startOnVisible?: boolean;
  reverseMode?: boolean;
};

export default function TextType({
  text,
  as: Component = "div",
  typingSpeed = 50,
  initialDelay = 0,
  pauseDuration = 2000,
  deletingSpeed = 30,
  loop = true,
  className = "",
  showCursor = true,
  hideCursorWhileTyping = false,
  cursorCharacter = "|",
  cursorClassName = "",
  cursorBlinkDuration = 0.5,
  textColors = [],
  variableSpeed,
  onSentenceComplete,
  startOnVisible = false,
  reverseMode = false,
  ...props
}: TextTypeProps) {
  const [displayedText, setDisplayedText] = useState("");
  const [currentCharIndex, setCurrentCharIndex] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);
  const [currentTextIndex, setCurrentTextIndex] = useState(0);
  const [isVisible, setIsVisible] = useState(!startOnVisible);
  const cursorRef = useRef<HTMLSpanElement | null>(null);
  const containerRef = useRef<HTMLElement | null>(null);
  const textArray = useMemo(() => (Array.isArray(text) ? text : [text]), [text]);

  const getRandomSpeed = useCallback(() => {
    if (!variableSpeed) return typingSpeed;
    return Math.random() * (variableSpeed.max - variableSpeed.min) + variableSpeed.min;
  }, [typingSpeed, variableSpeed]);

  useEffect(() => {
    if (!startOnVisible || !containerRef.current) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setIsVisible(true);
    }, { threshold: 0.1 });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [startOnVisible]);

  useEffect(() => {
    if (!showCursor || !cursorRef.current) return;
    gsap.set(cursorRef.current, { opacity: 1 });
    const tween = gsap.to(cursorRef.current, {
      opacity: 0,
      duration: cursorBlinkDuration,
      repeat: -1,
      yoyo: true,
      ease: "power2.inOut"
    });
    return () => {
      tween.kill();
    };
  }, [cursorBlinkDuration, showCursor]);

  useEffect(() => {
    if (!isVisible) return;
    let timeout: number | undefined;
    const currentText = textArray[currentTextIndex] ?? "";
    const processedText = reverseMode ? Array.from(currentText).reverse().join("") : currentText;

    const run = () => {
      if (isDeleting) {
        if (!displayedText) {
          setIsDeleting(false);
          onSentenceComplete?.(textArray[currentTextIndex] ?? "", currentTextIndex);
          if (currentTextIndex === textArray.length - 1 && !loop) return;
          setCurrentTextIndex((current) => (current + 1) % textArray.length);
          setCurrentCharIndex(0);
        } else {
          timeout = window.setTimeout(() => setDisplayedText((current) => current.slice(0, -1)), deletingSpeed);
        }
        return;
      }
      if (currentCharIndex < processedText.length) {
        timeout = window.setTimeout(() => {
          setDisplayedText((current) => current + processedText[currentCharIndex]);
          setCurrentCharIndex((current) => current + 1);
        }, variableSpeed ? getRandomSpeed() : typingSpeed);
      } else if (textArray.length > 1) {
        if (!loop && currentTextIndex === textArray.length - 1) return;
        timeout = window.setTimeout(() => setIsDeleting(true), pauseDuration);
      }
    };

    timeout = window.setTimeout(run, currentCharIndex === 0 && !isDeleting && !displayedText ? initialDelay : 0);
    return () => window.clearTimeout(timeout);
  }, [currentCharIndex, currentTextIndex, deletingSpeed, displayedText, getRandomSpeed, initialDelay, isDeleting, isVisible, loop, onSentenceComplete, pauseDuration, reverseMode, textArray, typingSpeed, variableSpeed]);

  const shouldHideCursor = hideCursorWhileTyping && (currentCharIndex < (textArray[currentTextIndex] ?? "").length || isDeleting);
  const color = textColors.length ? textColors[currentTextIndex % textColors.length] : undefined;

  return (
    <Component ref={containerRef} className={`text-type ${className}`} {...props}>
      <span className="text-type__content" style={{ color }}>{displayedText}</span>
      {showCursor ? (
        <span ref={cursorRef} className={`text-type__cursor ${cursorClassName} ${shouldHideCursor ? "text-type__cursor--hidden" : ""}`}>
          {cursorCharacter}
        </span>
      ) : null}
    </Component>
  );
}
