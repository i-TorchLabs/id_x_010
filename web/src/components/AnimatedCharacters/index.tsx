"use client";

import { useEffect, useRef, useState } from "react";

// ─── Pupil Sub-Component ────────────────────────────────────────────────────

interface PupilProps {
  size?: number;
  maxDistance?: number;
  pupilColor?: string;
  forceLookX?: number;
  forceLookY?: number;
}

function Pupil({
  size = 12,
  maxDistance = 5,
  pupilColor = "#1d1d1f",
  forceLookX,
  forceLookY,
}: PupilProps) {
  const [mouseX, setMouseX] = useState(0);
  const [mouseY, setMouseY] = useState(0);
  const pupilRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMouseX(e.clientX);
      setMouseY(e.clientY);
    };

    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  const calculatePupilPosition = (): { x: number; y: number } => {
    if (!pupilRef.current) return { x: 0, y: 0 };

    if (forceLookX !== undefined && forceLookY !== undefined) {
      return { x: forceLookX, y: forceLookY };
    }

    const pupil = pupilRef.current.getBoundingClientRect();
    const pupilCenterX = pupil.left + pupil.width / 2;
    const pupilCenterY = pupil.top + pupil.height / 2;

    const deltaX = mouseX - pupilCenterX;
    const deltaY = mouseY - pupilCenterY;
    const distance = Math.min(
      Math.sqrt(deltaX ** 2 + deltaY ** 2),
      maxDistance,
    );

    const angle = Math.atan2(deltaY, deltaX);
    return { x: Math.cos(angle) * distance, y: Math.sin(angle) * distance };
  };

  const pos = calculatePupilPosition();

  return (
    <div
      ref={pupilRef}
      style={{
        width: `${size}px`,
        height: `${size}px`,
        backgroundColor: pupilColor,
        borderRadius: "50%",
        transform: `translate(${pos.x}px, ${pos.y}px)`,
        transition: "transform 0.1s ease-out",
      }}
    />
  );
}

// ─── EyeBall Sub-Component ───────────────────────────────────────────────────

interface EyeBallProps {
  size?: number;
  pupilSize?: number;
  maxDistance?: number;
  eyeColor?: string;
  pupilColor?: string;
  isBlinking?: boolean;
  forceLookX?: number;
  forceLookY?: number;
}

function EyeBall({
  size = 18,
  pupilSize = 7,
  maxDistance = 5,
  eyeColor = "white",
  pupilColor = "#1d1d1f",
  isBlinking = false,
  forceLookX,
  forceLookY,
}: EyeBallProps) {
  const [mouseX, setMouseX] = useState(0);
  const [mouseY, setMouseY] = useState(0);
  const eyeRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMouseX(e.clientX);
      setMouseY(e.clientY);
    };

    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  const calculatePupilPosition = (): { x: number; y: number } => {
    if (!eyeRef.current) return { x: 0, y: 0 };

    if (forceLookX !== undefined && forceLookY !== undefined) {
      return { x: forceLookX, y: forceLookY };
    }

    const eye = eyeRef.current.getBoundingClientRect();
    const eyeCenterX = eye.left + eye.width / 2;
    const eyeCenterY = eye.top + eye.height / 2;

    const deltaX = mouseX - eyeCenterX;
    const deltaY = mouseY - eyeCenterY;
    const distance = Math.min(
      Math.sqrt(deltaX ** 2 + deltaY ** 2),
      maxDistance,
    );

    const angle = Math.atan2(deltaY, deltaX);
    return { x: Math.cos(angle) * distance, y: Math.sin(angle) * distance };
  };

  const pos = calculatePupilPosition();

  return (
    <div
      ref={eyeRef}
      style={{
        width: `${size}px`,
        height: isBlinking ? "2px" : `${size}px`,
        backgroundColor: eyeColor,
        borderRadius: "50%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        transition: "height 0.15s ease",
      }}
    >
      {!isBlinking ? (
        <div
          style={{
            width: `${pupilSize}px`,
            height: `${pupilSize}px`,
            backgroundColor: pupilColor,
            borderRadius: "50%",
            transform: `translate(${pos.x}px, ${pos.y}px)`,
            transition: "transform 0.1s ease-out",
          }}
        />
      ) : null}
    </div>
  );
}

// ─── AnimatedCharacters Component ───────────────────────────────────────────

export interface AnimatedCharactersProps {
  isTyping?: boolean;
  isPasswordFocused?: boolean;
  showPassword?: boolean;
  passwordLength?: number;
}

interface CharacterPosition {
  faceX: number;
  faceY: number;
  bodySkew: number;
}

function AnimatedCharacters({
  isTyping = false,
  isPasswordFocused = false,
  showPassword = false,
  passwordLength = 0,
}: AnimatedCharactersProps) {
  const [mouseX, setMouseX] = useState(0);
  const [mouseY, setMouseY] = useState(0);
  const [isPurpleBlinking, setIsPurpleBlinking] = useState(false);
  const [isBlackBlinking, setIsBlackBlinking] = useState(false);
  const [isLookingAtEachOther, setIsLookingAtEachOther] = useState(false);
  const [isPurplePeeking, setIsPurplePeeking] = useState(false);

  const purpleRef = useRef<HTMLDivElement | null>(null);
  const blackRef = useRef<HTMLDivElement | null>(null);
  const yellowRef = useRef<HTMLDivElement | null>(null);
  const orangeRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMouseX(e.clientX);
      setMouseY(e.clientY);
    };

    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  // Purple character random blinking
  useEffect(() => {
    const run = (): ReturnType<typeof setTimeout> => {
      const t = setTimeout(
        () => {
          setIsPurpleBlinking(true);
          setTimeout(() => {
            setIsPurpleBlinking(false);
            run();
          }, 150);
        },
        Math.random() * 4000 + 3000,
      );
      return t;
    };

    const timeout = run();
    return () => clearTimeout(timeout);
  }, []);

  // Black character random blinking
  useEffect(() => {
    const run = (): ReturnType<typeof setTimeout> => {
      const t = setTimeout(
        () => {
          setIsBlackBlinking(true);
          setTimeout(() => {
            setIsBlackBlinking(false);
            run();
          }, 150);
        },
        Math.random() * 4000 + 3000,
      );
      return t;
    };

    const timeout = run();
    return () => clearTimeout(timeout);
  }, []);

  // Look at each other when typing
  useEffect(() => {
    if (isTyping) {
      setIsLookingAtEachOther(true);
      const timer = setTimeout(() => setIsLookingAtEachOther(false), 800);
      return () => clearTimeout(timer);
    }
    setIsLookingAtEachOther(false);
  }, [isTyping]);

  // Purple peeking when password is shown
  useEffect(() => {
    if (passwordLength > 0 && showPassword) {
      const peek = setTimeout(
        () => {
          setIsPurplePeeking(true);
          setTimeout(() => setIsPurplePeeking(false), 800);
        },
        Math.random() * 3000 + 2000,
      );
      return () => clearTimeout(peek);
    }
    setIsPurplePeeking(false);
  }, [passwordLength, showPassword, isPurplePeeking]);

  const calculatePosition = (
    ref: React.RefObject<HTMLDivElement | null>,
  ): CharacterPosition => {
    if (!ref.current) return { faceX: 0, faceY: 0, bodySkew: 0 };

    const rect = ref.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 3;

    const deltaX = mouseX - centerX;
    const deltaY = mouseY - centerY;

    return {
      faceX: Math.max(-15, Math.min(15, deltaX / 20)),
      faceY: Math.max(-10, Math.min(10, deltaY / 30)),
      bodySkew: Math.max(-6, Math.min(6, -deltaX / 120)),
    };
  };

  const purplePos = calculatePosition(purpleRef);
  const blackPos = calculatePosition(blackRef);
  const yellowPos = calculatePosition(yellowRef);
  const orangePos = calculatePosition(orangeRef);

  const isHidingPassword = passwordLength > 0 && !showPassword;
  const isLookingAway = isPasswordFocused && !showPassword;

  return (
    <div style={{ position: "relative", width: "550px", height: "400px" }}>
      {/* ── Purple Character ── */}
      <div
        ref={purpleRef}
        style={{
          position: "absolute",
          bottom: 0,
          left: "70px",
          width: "180px",
          height:
            isLookingAway || isTyping || isHidingPassword ? "440px" : "400px",
          backgroundColor: "#0071e3",
          borderRadius: "10px 10px 0 0",
          zIndex: 1,
          transform:
            passwordLength > 0 && showPassword
              ? "skewX(0deg) translateZ(0)"
              : isLookingAway
                ? "skewX(-14deg) translateX(-20px) translateZ(0)"
                : isTyping || isHidingPassword
                  ? `skewX(${(purplePos.bodySkew || 0) - 12}deg) translateX(40px) translateZ(0)`
                  : `skewX(${purplePos.bodySkew || 0}deg) translateZ(0)`,
          transformOrigin: "bottom center",
          willChange: "transform, height",
          backfaceVisibility: "hidden",
          WebkitBackfaceVisibility: "hidden",
          transition: "all 0.7s ease-in-out",
        }}
      >
        <div
          style={{
            position: "absolute",
            display: "flex",
            gap: "32px",
            left: isLookingAway
              ? "20px"
              : passwordLength > 0 && showPassword
                ? "20px"
                : isLookingAtEachOther
                  ? "55px"
                  : `${45 + purplePos.faceX}px`,
            top: isLookingAway
              ? "25px"
              : passwordLength > 0 && showPassword
                ? "35px"
                : isLookingAtEachOther
                  ? "65px"
                  : `${40 + purplePos.faceY}px`,
            transition: "all 0.7s ease-in-out",
          }}
        >
          <EyeBall
            size={18}
            pupilSize={7}
            maxDistance={5}
            isBlinking={isPurpleBlinking}
            forceLookX={
              isLookingAway
                ? -5
                : passwordLength > 0 && showPassword
                  ? isPurplePeeking
                    ? 4
                    : -4
                  : isLookingAtEachOther
                    ? 3
                    : undefined
            }
            forceLookY={
              isLookingAway
                ? -5
                : passwordLength > 0 && showPassword
                  ? isPurplePeeking
                    ? 5
                    : -4
                  : isLookingAtEachOther
                    ? 4
                    : undefined
            }
          />
          <EyeBall
            size={18}
            pupilSize={7}
            maxDistance={5}
            isBlinking={isPurpleBlinking}
            forceLookX={
              isLookingAway
                ? -5
                : passwordLength > 0 && showPassword
                  ? isPurplePeeking
                    ? 4
                    : -4
                  : isLookingAtEachOther
                    ? 3
                    : undefined
            }
            forceLookY={
              isLookingAway
                ? -5
                : passwordLength > 0 && showPassword
                  ? isPurplePeeking
                    ? 5
                    : -4
                  : isLookingAtEachOther
                    ? 4
                    : undefined
            }
          />
        </div>
      </div>

      {/* ── Black Character ── */}
      <div
        ref={blackRef}
        style={{
          position: "absolute",
          bottom: 0,
          left: "240px",
          width: "120px",
          height: "310px",
          backgroundColor: "#1d1d1f",
          borderRadius: "8px 8px 0 0",
          zIndex: 2,
          transform:
            passwordLength > 0 && showPassword
              ? "skewX(0deg) translateZ(0)"
              : isLookingAway
                ? "skewX(12deg) translateX(-10px) translateZ(0)"
                : isLookingAtEachOther
                  ? `skewX(${(blackPos.bodySkew || 0) * 1.5 + 10}deg) translateX(20px) translateZ(0)`
                  : isTyping || isHidingPassword
                    ? `skewX(${(blackPos.bodySkew || 0) * 1.5}deg) translateZ(0)`
                    : `skewX(${blackPos.bodySkew || 0}deg) translateZ(0)`,
          transformOrigin: "bottom center",
          willChange: "transform",
          backfaceVisibility: "hidden",
          WebkitBackfaceVisibility: "hidden",
          transition: "all 0.7s ease-in-out",
        }}
      >
        <div
          style={{
            position: "absolute",
            display: "flex",
            gap: "24px",
            left: isLookingAway
              ? "10px"
              : passwordLength > 0 && showPassword
                ? "10px"
                : isLookingAtEachOther
                  ? "32px"
                  : `${26 + blackPos.faceX}px`,
            top: isLookingAway
              ? "20px"
              : passwordLength > 0 && showPassword
                ? "28px"
                : isLookingAtEachOther
                  ? "12px"
                  : `${32 + blackPos.faceY}px`,
            transition: "all 0.7s ease-in-out",
          }}
        >
          <EyeBall
            size={16}
            pupilSize={6}
            maxDistance={4}
            isBlinking={isBlackBlinking}
            forceLookX={
              isLookingAway
                ? -4
                : passwordLength > 0 && showPassword
                  ? -4
                  : isLookingAtEachOther
                    ? 0
                    : undefined
            }
            forceLookY={
              isLookingAway
                ? -5
                : passwordLength > 0 && showPassword
                  ? -4
                  : isLookingAtEachOther
                    ? -4
                    : undefined
            }
          />
          <EyeBall
            size={16}
            pupilSize={6}
            maxDistance={4}
            isBlinking={isBlackBlinking}
            forceLookX={
              isLookingAway
                ? -4
                : passwordLength > 0 && showPassword
                  ? -4
                  : isLookingAtEachOther
                    ? 0
                    : undefined
            }
            forceLookY={
              isLookingAway
                ? -5
                : passwordLength > 0 && showPassword
                  ? -4
                  : isLookingAtEachOther
                    ? -4
                    : undefined
            }
          />
        </div>
      </div>

      {/* ── Orange Character ── */}
      <div
        ref={orangeRef}
        style={{
          position: "absolute",
          bottom: 0,
          left: "0px",
          width: "240px",
          height: "200px",
          zIndex: 3,
          backgroundColor: "#FF9B6B",
          borderRadius: "120px 120px 0 0",
          transform:
            passwordLength > 0 && showPassword
              ? "skewX(0deg) translateZ(0)"
              : `skewX(${orangePos.bodySkew || 0}deg) translateZ(0)`,
          transformOrigin: "bottom center",
          willChange: "transform",
          backfaceVisibility: "hidden",
          WebkitBackfaceVisibility: "hidden",
          boxShadow: "inset 0 -2px 0 #FF9B6B",
          transition: "all 0.7s ease-in-out",
        }}
      >
        <div
          style={{
            position: "absolute",
            display: "flex",
            gap: "32px",
            left: isLookingAway
              ? "50px"
              : passwordLength > 0 && showPassword
                ? "50px"
                : `${82 + (orangePos.faceX || 0)}px`,
            top: isLookingAway
              ? "75px"
              : passwordLength > 0 && showPassword
                ? "85px"
                : `${90 + (orangePos.faceY || 0)}px`,
            transition: "all 0.2s ease-out",
          }}
        >
          <Pupil
            size={12}
            maxDistance={5}
            forceLookX={
              isLookingAway
                ? -5
                : passwordLength > 0 && showPassword
                  ? -5
                  : undefined
            }
            forceLookY={
              isLookingAway
                ? -5
                : passwordLength > 0 && showPassword
                  ? -4
                  : undefined
            }
          />
          <Pupil
            size={12}
            maxDistance={5}
            forceLookX={
              isLookingAway
                ? -5
                : passwordLength > 0 && showPassword
                  ? -5
                  : undefined
            }
            forceLookY={
              isLookingAway
                ? -5
                : passwordLength > 0 && showPassword
                  ? -4
                  : undefined
            }
          />
        </div>
      </div>

      {/* ── Yellow Character ── */}
      <div
        ref={yellowRef}
        style={{
          position: "absolute",
          bottom: 0,
          left: "310px",
          width: "140px",
          height: "230px",
          backgroundColor: "#E8D754",
          borderRadius: "70px 70px 0 0",
          zIndex: 4,
          transform:
            passwordLength > 0 && showPassword
              ? "skewX(0deg) translateZ(0)"
              : `skewX(${yellowPos.bodySkew || 0}deg) translateZ(0)`,
          transformOrigin: "bottom center",
          willChange: "transform",
          backfaceVisibility: "hidden",
          WebkitBackfaceVisibility: "hidden",
          boxShadow: "inset 0 -2px 0 #E8D754",
          transition: "all 0.7s ease-in-out",
        }}
      >
        <div
          style={{
            position: "absolute",
            display: "flex",
            gap: "24px",
            left: isLookingAway
              ? "20px"
              : passwordLength > 0 && showPassword
                ? "20px"
                : `${52 + (yellowPos.faceX || 0)}px`,
            top: isLookingAway
              ? "30px"
              : passwordLength > 0 && showPassword
                ? "35px"
                : `${40 + (yellowPos.faceY || 0)}px`,
            transition: "all 0.2s ease-out",
          }}
        >
          <Pupil
            size={12}
            maxDistance={5}
            forceLookX={
              isLookingAway
                ? -5
                : passwordLength > 0 && showPassword
                  ? -5
                  : undefined
            }
            forceLookY={
              isLookingAway
                ? -5
                : passwordLength > 0 && showPassword
                  ? -4
                  : undefined
            }
          />
          <Pupil
            size={12}
            maxDistance={5}
            forceLookX={
              isLookingAway
                ? -5
                : passwordLength > 0 && showPassword
                  ? -5
                  : undefined
            }
            forceLookY={
              isLookingAway
                ? -5
                : passwordLength > 0 && showPassword
                  ? -4
                  : undefined
            }
          />
        </div>
        {/* Yellow character mouth */}
        <div
          style={{
            position: "absolute",
            width: "80px",
            height: "4px",
            backgroundColor: "#1d1d1f",
            borderRadius: "999px",
            left: isLookingAway
              ? "15px"
              : passwordLength > 0 && showPassword
                ? "10px"
                : `${40 + (yellowPos.faceX || 0)}px`,
            top: isLookingAway
              ? "78px"
              : passwordLength > 0 && showPassword
                ? "88px"
                : `${88 + (yellowPos.faceY || 0)}px`,
            transition: "all 0.2s ease-out",
          }}
        />
      </div>
    </div>
  );
}

export { AnimatedCharacters };
export default AnimatedCharacters;
