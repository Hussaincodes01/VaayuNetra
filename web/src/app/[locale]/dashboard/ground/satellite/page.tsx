import { SatelliteResults } from "@/components/ground/SatelliteResults";

export const dynamic = "force-dynamic";

/** VayuNetra's satellite model re-run on the cached Deonar passes, with tiers and evidence. */
export default function GroundSatellitePage() {
  return <SatelliteResults />;
}
