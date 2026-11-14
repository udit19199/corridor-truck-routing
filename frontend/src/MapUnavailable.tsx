/**
 * One message for a map that cannot draw, shared by the error boundary that
 * catches a failed map chunk or missing WebGL and by the map's own failures.
 */
export default function MapUnavailable({ reason }: { reason: string }) {
  return (
    <div className="map-loading" role="alert">
      <p className="map-unavailable">
        The map could not load. {reason} Routes and checkpoints stay in the panel.
      </p>
    </div>
  );
}
