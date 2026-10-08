import { WindResults } from "@/components/ground/WindResults";

export const dynamic = "force-dynamic";

/** The wind-forecast model slot: Chronos-2's backtest on real ERA5 hours and its last live run. */
export default function GroundWindPage() {
  return <WindResults />;
}
