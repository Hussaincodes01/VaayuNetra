import { Composition } from "remotion";
import { Film } from "./Film";

const FPS = 30;
const DURATION_SECONDS = 5 * 60;

export const RemotionRoot: React.FC = () => (
  <Composition
    id="VayuNetraFilm"
    component={Film}
    durationInFrames={DURATION_SECONDS * FPS}
    fps={FPS}
    width={1920}
    height={1080}
  />
);
