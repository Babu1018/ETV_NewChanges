import { useEffect, useState } from "react";
import userSpeakImg from "../assets/user-speak.png";
import homeWavesImg from "../assets/home-waves.png";

const SLIDES = [
  {
    id: "tts",
    badge: "LIVE SPEECH",
    image: userSpeakImg,
    imageAlt: "Text to speech illustration",
    description: (
      <>
        Convert <strong>text into natural-sounding speech</strong> across multiple Indian
        languages.
      </>
    ),
  },
  {
    id: "asr",
    badge: "LIVE TRANSCRIPTION",
    image: homeWavesImg,
    imageAlt: "Speech recognition illustration",
    description: (
      <>
        Convert <strong>spoken audio into text</strong> using advanced AI-powered speech
        recognition.
      </>
    ),
  },
];

const SLIDE_INTERVAL_MS = 5000;

export default function HubFeatureSlider() {
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % SLIDES.length);
    }, SLIDE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="hub-feature-card">
      <div className="hub-slider" aria-live="polite">
        <div
          className="hub-slider-track"
          style={{ transform: `translateX(-${activeIndex * 100}%)` }}
        >
          {SLIDES.map((slide) => (
            <div key={slide.id} className="hub-slider-slide">
              <div className="hub-feature-badge">
                <span className="hub-feature-badge-dot" aria-hidden />
                {slide.badge}
              </div>
              <div className="hub-slider-visual">
                <img
                  src={slide.image}
                  alt={slide.imageAlt}
                  className="hub-slider-image"
                  draggable={false}
                />
              </div>
              <p className="hub-slider-caption">{slide.description}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
