import { useEffect, useState, type FormEvent, type KeyboardEvent } from "react";
import { geocode, type IntervalMi, type Place, type PlanRequest } from "./api";
import { localDateTimeToIso, nextHourInputValue } from "./format";

type SearchState =
  | { status: "idle"; options: Place[] }
  | { status: "searching"; options: Place[] }
  | { status: "done"; options: Place[] }
  | { status: "failed"; options: Place[] };

interface PlacePickerProps {
  inputId: string;
  testId: string;
  label: string;
  placeholder: string;
  value: Place | null;
  onChange: (place: Place | null) => void;
}

function PlacePicker({
  inputId,
  testId,
  label,
  placeholder,
  value,
  onChange,
}: PlacePickerProps) {
  const [query, setQuery] = useState(value?.label ?? "");
  const [search, setSearch] = useState<SearchState>({
    status: "idle",
    options: [],
  });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listShown = open && (search.options.length > 0 || search.status !== "idle");
  const statusText =
    search.status === "searching"
      ? "Searching"
      : search.status === "failed"
        ? "Place search is unavailable. Try again."
        : search.status === "done"
          ? search.options.length === 0
            ? `No US place matches ${query.trim()}.`
            : `${search.options.length} matches. Use the arrow keys to choose.`
          : "";

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2 || (value !== null && trimmed === value.label)) {
      setSearch({ status: "idle", options: [] });
      setOpen(false);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSearch({ status: "searching", options: [] });
      geocode(trimmed, controller.signal)
        .then((options) => {
          if (controller.signal.aborted) {
            return;
          }
          setSearch({ status: "done", options });
          setActive(options.length > 0 ? 0 : -1);
          setOpen(true);
        })
        .catch(() => {
          if (controller.signal.aborted) {
            return;
          }
          setSearch({ status: "failed", options: [] });
          setOpen(true);
        });
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, value]);

  function choose(place: Place) {
    setQuery(place.label);
    onChange(place);
    setOpen(false);
    setActive(-1);
    setSearch({ status: "idle", options: [] });
  }

  function handleInput(next: string) {
    setQuery(next);
    // Old matches must not stay choosable while the debounced search for the new text waits.
    setSearch({ status: "idle", options: [] });
    setActive(-1);
    if (value !== null && next !== value.label) {
      onChange(null);
    }
    setOpen(true);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      if (search.options.length > 0) {
        setActive((current) =>
          Math.min(current + 1, search.options.length - 1),
        );
      }
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) => Math.max(current - 1, 0));
      return;
    }
    if (event.key === "Enter" && open) {
      const option = search.options[active >= 0 ? active : 0];
      if (option !== undefined) {
        event.preventDefault();
        choose(option);
      }
      return;
    }
    if (event.key === "Escape" || event.key === "Tab") {
      setOpen(false);
      setActive(-1);
    }
  }

  const listId = `${inputId}-listbox`;
  const activeOption =
    open && active >= 0 ? `${inputId}-option-${active}` : undefined;

  return (
    <div className="field">
      <label htmlFor={inputId}>{label}</label>
      <div className="input-shell">
        <input
          id={inputId}
          data-testid={testId}
          className="text-input"
          type="text"
          role="combobox"
          aria-haspopup="listbox"
          aria-autocomplete="list"
          aria-expanded={listShown}
          aria-controls={listId}
          aria-activedescendant={activeOption}
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder}
          value={query}
          onChange={(event) => handleInput(event.target.value)}
          onFocus={() => {
            if (
              search.options.length > 0 ||
              search.status === "done" ||
              search.status === "failed"
            ) {
              setOpen(true);
            }
          }}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            window.setTimeout(() => setOpen(false), 120);
          }}
        />
        <p className="sr-only" aria-live="polite">
          {statusText}
        </p>
        {listShown && (
          <ul
            className="place-list"
            id={listId}
            role="listbox"
            aria-label={`${label} matches`}
          >
            {search.status === "searching" && (
              <li className="place-status" aria-hidden="true">
                Searching…
              </li>
            )}
            {search.status === "failed" && (
              <li className="place-status" aria-hidden="true">
                Place search is unavailable. Try again.
              </li>
            )}
            {search.status === "done" && search.options.length === 0 && (
              <li className="place-status" aria-hidden="true">
                No US place matches “{query.trim()}”.
              </li>
            )}
            {search.options.map((place, index) => (
              <li
                key={`${place.lon},${place.lat},${place.label}`}
                id={`${inputId}-option-${index}`}
                data-testid="place-option"
                role="option"
                aria-selected={index === active}
                data-active={index === active}
                className="place-option"
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(place)}
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 12 12"
                  aria-hidden="true"
                >
                  <circle
                    cx="6"
                    cy="6"
                    r="4.2"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.3"
                  />
                  <circle cx="6" cy="6" r="1.4" fill="currentColor" />
                </svg>
                <span>{place.label}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

interface TripFormProps {
  loading: boolean;
  hasPlan: boolean;
  onSubmit: (request: PlanRequest) => void;
}

export default function TripForm({
  loading,
  hasPlan,
  onSubmit,
}: TripFormProps) {
  const [origin, setOrigin] = useState<Place | null>(null);
  const [destination, setDestination] = useState<Place | null>(null);
  const [departure, setDeparture] = useState(() => nextHourInputValue());
  const [load, setLoad] = useState("40000");
  const [interval, setIntervalMi] = useState<IntervalMi>(25);

  function buildRequest(intervalMi: IntervalMi): PlanRequest | null {
    if (origin === null || destination === null) {
      return null;
    }
    const departureIso = localDateTimeToIso(departure);
    if (departureIso === null) {
      return null;
    }
    const loadLb = Number(load);
    if (!Number.isFinite(loadLb) || loadLb < 1 || loadLb > 45_000) {
      return null;
    }
    return {
      origin,
      destination,
      departure: departureIso,
      load_lb: Math.round(loadLb),
      interval_mi: intervalMi,
    };
  }

  const canSubmit = buildRequest(interval) !== null;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const request = buildRequest(interval);
    if (request !== null) {
      onSubmit(request);
    }
  }

  function handleInterval(next: IntervalMi) {
    if (next === interval) {
      return;
    }
    setIntervalMi(next);
    if (!hasPlan) {
      return;
    }
    const request = buildRequest(next);
    if (request !== null) {
      onSubmit(request);
    }
  }

  return (
    <form className="trip-form" onSubmit={handleSubmit} noValidate>
      <PlacePicker
        inputId="origin-input"
        testId="origin-input"
        label="Origin"
        placeholder="City or town"
        value={origin}
        onChange={setOrigin}
      />
      <PlacePicker
        inputId="destination-input"
        testId="destination-input"
        label="Destination"
        placeholder="City or town"
        value={destination}
        onChange={setDestination}
      />

      <div className="field">
        <label htmlFor="departure-input">
          Departure
          <span className="field-note">local time</span>
        </label>
        <input
          id="departure-input"
          data-testid="departure-input"
          className="text-input"
          type="datetime-local"
          value={departure}
          onChange={(event) => setDeparture(event.target.value)}
        />
      </div>

      <div className="form-row">
        <div className="field">
          <label htmlFor="load-input">Load</label>
          <div className="input-shell">
            <input
              id="load-input"
              data-testid="load-input"
              className="text-input text-input-suffix"
              type="number"
              min={1}
              max={45000}
              step={500}
              inputMode="numeric"
              value={load}
              onChange={(event) => setLoad(event.target.value)}
            />
            <span className="input-suffix" aria-hidden="true">
              lb
            </span>
          </div>
        </div>

        <div className="field">
          <span className="field-label" id="interval-label">
            Checkpoints
            <span className="field-note">mi</span>
          </span>
          <div
            className="segmented"
            role="group"
            aria-labelledby="interval-label"
          >
            {([10, 25, 50] as const).map((miles) => (
              <button
                key={miles}
                type="button"
                data-testid={`interval-${miles}`}
                aria-pressed={interval === miles}
                aria-label={`Checkpoint every ${miles} miles`}
                onClick={() => handleInterval(miles)}
              >
                {miles}
              </button>
            ))}
          </div>
        </div>
      </div>

      <button
        type="submit"
        data-testid="plan-submit"
        className="plan-button"
        disabled={loading || !canSubmit}
        title={
          canSubmit || loading
            ? undefined
            : "Choose both cities and enter a load between 1 and 45,000 lb"
        }
      >
        {loading ? (
          <>
            <span className="spinner" aria-hidden="true" />
            Planning…
          </>
        ) : (
          <>
            Plan trip
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path
                d="M2 7h9M8 3.5 11.5 7 8 10.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </>
        )}
      </button>
    </form>
  );
}
