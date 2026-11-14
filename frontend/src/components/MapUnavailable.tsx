export default function MapUnavailable({ reason }: { reason: string }) {
  return (
    <div className="map-loading" role="alert">
      <p className="map-unavailable">
        The map could not load. {reason} Routes and checkpoints stay in the panel.
      </p>
    </div>
  );
}
