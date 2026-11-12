import {
  useEffect,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { geocode, type IntervalMi, type Place, type PlanRequest } from "./api";
import { localDateTimeToIso, nextHourInputValue } from "./format";

const MIN_LOAD_LB = 1;
const MAX_LOAD_LB = 45_000;
const EARLIEST_DEPARTURE_MS = 3_600_000;
const LATEST_DEPARTURE_MS = 12 * 86_400_000;
const INTERVAL_CHOICES = [10, 25, 50] as const;

type SearchState =
  | { status: "idle" | "searching" | "failed" }
  | { status: "done"; options: Place[] };

/**
 * Debounced place search plus the listbox state that follows from it. A query
 * that matches the chosen place, or is too short, clears the list.
 */
function usePlaceSearch(query: string, value: Place | null) {
  const [placeSearch, setPlaceSearch] = useState<SearchState>({
    status: "idle",
  });
  const [listOpen, setListOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2 || (value !== null && trimmed === value.label)) {
      setPlaceSearch({ status: "idle" });
      setListOpen(false);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setPlaceSearch({ status: "searching" });
      geocode(trimmed, controller.signal)
        .then((options) => {
          if (controller.signal.aborted) {
            return;
          }
          setPlaceSearch({ status: "done", options });
          setActiveIndex(options.length > 0 ? 0 : -1);
          setListOpen(true);
        })
        .catch(() => {
          if (controller.signal.aborted) {
            return;
          }
          setPlaceSearch({ status: "failed" });
          setListOpen(true);
        });
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, value]);

  function resetSearch() {
    setPlaceSearch({ status: "idle" });
    setActiveIndex(-1);
  }

  return {
    placeSearch,
    listOpen,
    setListOpen,
    activeIndex,
    setActiveIndex,
    resetSearch,
  };
}

function searchStatusText(placeSearch: SearchState, query: string): string {
  if (placeSearch.status === "searching") {
    return "Searching…";
  }
  if (placeSearch.status === "failed") {
    return "Place search is unavailable. Try again.";
  }
  if (placeSearch.status !== "done") {
    return "";
  }
  if (placeSearch.options.length === 0) {
    return `No US place matches “${query.trim()}”.`;
  }
  return `${placeSearch.options.length} matches. Use the arrow keys to choose.`;
}

function placeMessage(
  query: string,
  value: Place | null,
  issue: string | null,
  showMessage: boolean,
  emptyMessage: string,
): string | null {
  if (!showMessage) {
    return null;
  }
  if (issue !== null) {
    return issue;
  }
  if (value !== null) {
    return null;
  }
  return query.trim() === "" ? emptyMessage : "Pick a place from the list.";
}

function nextActiveIndex(
  current: number,
  delta: 1 | -1,
  count: number,
): number {
  return delta === 1
    ? Math.min(current + 1, count - 1)
    : Math.max(current - 1, 0);
}

function activePlace(options: Place[], activeIndex: number): Place | null {
  return options[activeIndex >= 0 ? activeIndex : 0] ?? null;
}

function preventBlur(event: MouseEvent<HTMLLIElement>) {
  // A click on an option must not blur the input before the click lands.
  event.preventDefault();
}

/**
 * Leaving a field by pressing the submit button is a submit attempt, and the submit
 * handler shows the messages itself. Showing them on the blur would move the button
 * down between mousedown and mouseup, so the click would land on the form instead.
 */
function leavesToSubmit(target: EventTarget | null): boolean {
  return target instanceof HTMLButtonElement && target.type === "submit";
}

interface ComboboxKeys {
  openList: () => void;
  closeList: () => void;
  stepActive: (delta: 1 | -1) => void;
  chooseActive: () => void;
}

function handleComboboxKey(
  event: KeyboardEvent<HTMLInputElement>,
  listOpen: boolean,
  keys: ComboboxKeys,
) {
  const { key } = event;
  if (key === "ArrowDown" || key === "ArrowUp") {
    event.preventDefault();
    if (!listOpen) {
      keys.openList();
      return;
    }
    keys.stepActive(key === "ArrowDown" ? 1 : -1);
    return;
  }
  if (key === "Enter" && listOpen) {
    event.preventDefault();
    keys.chooseActive();
    return;
  }
  if (key === "Escape" || key === "Tab") {
    keys.closeList();
  }
}

interface PlaceListProps {
  inputId: string;
  label: string;
  statusText: string;
  options: Place[];
  activeIndex: number;
  onChoose: (place: Place) => void;
  onHover: (index: number) => void;
}

function PlaceList({
  inputId,
  label,
  statusText,
  options,
  activeIndex,
  onChoose,
  onHover,
}: PlaceListProps) {
  return (
    <ul
      className="place-list"
      id={`${inputId}-listbox`}
      role="listbox"
      aria-label={`${label} matches`}
    >
      {options.length === 0 && (
        <li className="place-status" aria-hidden="true">
          {statusText}
        </li>
      )}
      {options.map((place, index) => (
        <li
          key={`${place.lon},${place.lat},${place.label}`}
          id={`${inputId}-option-${index}`}
          data-testid="place-option"
          role="option"
          aria-selected={index === activeIndex}
          data-active={index === activeIndex}
          className="place-option"
          onMouseDown={preventBlur}
          onMouseEnter={() => onHover(index)}
          onClick={() => onChoose(place)}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
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
  );
}

interface PlacePickerProps {
  inputId: string;
  label: string;
  placeholder: string;
  /** Shown when the field is empty and the user has left it or tried to plan. */
  emptyMessage: string;
  value: Place | null;
  onChange: (place: Place | null) => void;
  /** Form-level message for this field, for example the same place twice. */
  issue: string | null;
  /** True once the user has left the field or tried to submit. */
  showMessage: boolean;
  onLeave: () => void;
}

function PlacePicker({
  inputId,
  label,
  placeholder,
  emptyMessage,
  value,
  onChange,
  issue,
  showMessage,
  onLeave,
}: PlacePickerProps) {
  const [query, setQuery] = useState(value?.label ?? "");
  const {
    placeSearch,
    listOpen,
    setListOpen,
    activeIndex,
    setActiveIndex,
    resetSearch,
  } = usePlaceSearch(query, value);
  const options = placeSearch.status === "done" ? placeSearch.options : [];
  const listShown =
    listOpen && (options.length > 0 || placeSearch.status !== "idle");
  const statusText = searchStatusText(placeSearch, query);
  const message = placeMessage(query, value, issue, showMessage, emptyMessage);

  function choose(place: Place) {
    setQuery(place.label);
    onChange(place);
    setListOpen(false);
    resetSearch();
  }

  function handleQueryChange(next: string) {
    setQuery(next);
    // Old matches must not stay choosable while the debounced search for the new text waits.
    resetSearch();
    if (value !== null && next !== value.label) {
      onChange(null);
    }
    setListOpen(true);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    handleComboboxKey(event, listOpen, {
      openList: () => setListOpen(true),
      closeList: () => {
        setListOpen(false);
        setActiveIndex(-1);
      },
      stepActive: (delta) =>
        setActiveIndex((current) =>
          nextActiveIndex(current, delta, options.length),
        ),
      chooseActive: () => {
        const place = activePlace(options, activeIndex);
        if (place !== null) {
          choose(place);
        }
      },
    });
  }

  const listId = `${inputId}-listbox`;
  const activeOption =
    listOpen && activeIndex >= 0 ? `${inputId}-option-${activeIndex}` : undefined;
  const errorId = `${inputId}-error`;

  return (
    <div className="field">
      <label htmlFor={inputId}>{label}</label>
      <div className="input-shell">
        <input
          id={inputId}
          data-testid={inputId}
          className="text-input"
          type="text"
          role="combobox"
          aria-haspopup="listbox"
          aria-autocomplete="list"
          aria-expanded={listShown}
          aria-controls={listShown ? listId : undefined}
          aria-activedescendant={activeOption}
          aria-invalid={message !== null}
          aria-describedby={message !== null ? errorId : undefined}
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder}
          value={query}
          onChange={(event) => handleQueryChange(event.target.value)}
          onFocus={() => {
            if (
              options.length > 0 ||
              placeSearch.status === "done" ||
              placeSearch.status === "failed"
            ) {
              setListOpen(true);
            }
          }}
          onKeyDown={handleKeyDown}
          onBlur={(event) => {
            window.setTimeout(() => setListOpen(false), 120);
            if (!leavesToSubmit(event.relatedTarget)) {
              onLeave();
            }
          }}
        />
        <p className="sr-only" aria-live="polite">
          {statusText}
        </p>
        {listShown && (
          <PlaceList
            inputId={inputId}
            label={label}
            statusText={statusText}
            options={options}
            activeIndex={activeIndex}
            onChoose={choose}
            onHover={setActiveIndex}
          />
        )}
      </div>
      {message !== null && (
        <p className="field-error" id={errorId} data-testid={errorId}>
          {message}
        </p>
      )}
    </div>
  );
}

const FIELD_INPUT_IDS = {
  origin: "origin-input",
  destination: "destination-input",
  departure: "departure-input",
  load: "load-input",
} as const;

type FieldKey = keyof typeof FIELD_INPUT_IDS;
const FIELD_ORDER: readonly FieldKey[] = [
  "origin",
  "destination",
  "departure",
  "load",
];

type FormIssues = Partial<Record<FieldKey, string>>;

function milesBetween(a: Place, b: Place): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const earthRadiusMi = 3958.8;
  const deltaLat = toRadians(b.lat - a.lat);
  const deltaLon = toRadians(b.lon - a.lon);
  const h =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(a.lat)) *
      Math.cos(toRadians(b.lat)) *
      Math.sin(deltaLon / 2) ** 2;
  return 2 * earthRadiusMi * Math.asin(Math.sqrt(h));
}

function dateTimeInputValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function checkForm(
  now: Date,
  origin: Place | null,
  destination: Place | null,
  departureText: string,
  loadText: string,
  intervalMi: IntervalMi,
): { request: PlanRequest | null; issues: FormIssues } {
  const issues: FormIssues = {};

  const departureIso = localDateTimeToIso(departureText);
  if (departureIso === null) {
    issues.departure = "Choose a departure time.";
  } else {
    const departureMs = Date.parse(departureIso);
    const earliestMs = now.getTime() - EARLIEST_DEPARTURE_MS;
    const latestMs = now.getTime() + LATEST_DEPARTURE_MS;
    if (departureMs < earliestMs || departureMs > latestMs) {
      issues.departure =
        "Departure must be between 1 hour ago and 12 days from now.";
    }
  }

  const loadLb = Number(loadText);
  if (loadText.trim() === "") {
    issues.load = "Enter the cargo weight.";
  } else if (loadLb < MIN_LOAD_LB || loadLb > MAX_LOAD_LB) {
    issues.load = "Cargo weight must be between 1 and 45,000 lb.";
  } else if (!Number.isInteger(loadLb)) {
    issues.load = "Cargo weight must be a whole number of pounds.";
  }

  if (
    origin !== null &&
    destination !== null &&
    milesBetween(origin, destination) < 1
  ) {
    issues.destination = "Origin and destination must be at least 1 mile apart.";
  }

  if (
    origin === null ||
    destination === null ||
    departureIso === null ||
    issues.departure !== undefined ||
    issues.load !== undefined
  ) {
    return { request: null, issues };
  }

  return {
    request: {
      origin,
      destination,
      departure: departureIso,
      load_lb: loadLb,
      interval_mi: intervalMi,
    },
    issues,
  };
}

function firstInvalidField(
  issues: FormIssues,
  origin: Place | null,
  destination: Place | null,
): FieldKey | null {
  for (const field of FIELD_ORDER) {
    if (field === "origin" && origin === null) {
      return field;
    }
    if (field === "destination" && destination === null) {
      return field;
    }
    if (issues[field] !== undefined) {
      return field;
    }
  }
  return null;
}

interface TripFormProps {
  loading: boolean;
  hasPlan: boolean;
  /**
   * Interval of the trip on screen, or null before the first plan. Without it the
   * form falls back to the last interval it submitted, which is wrong only when
   * that replan failed and the old trip is still on screen.
   */
  planIntervalMi?: IntervalMi | null;
  onSubmit: (request: PlanRequest) => void;
}

export default function TripForm({
  loading,
  hasPlan,
  planIntervalMi = null,
  onSubmit,
}: TripFormProps) {
  const [origin, setOrigin] = useState<Place | null>(null);
  const [destination, setDestination] = useState<Place | null>(null);
  const [departureText, setDepartureText] = useState(nextHourInputValue);
  const [loadText, setLoadText] = useState("40000");
  const [intervalMi, setIntervalMi] = useState<IntervalMi>(25);
  // The spacing of the last plan this form asked for. It only moves when a request
  // is sent, so an invalid form cannot make the buttons claim the shown trip uses it.
  const [submittedIntervalMi, setSubmittedIntervalMi] = useState<IntervalMi>(25);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [touched, setTouched] = useState<Record<FieldKey, boolean>>({
    origin: false,
    destination: false,
    departure: false,
    load: false,
  });
  const [now] = useState(() => new Date());

  const check = checkForm(
    now,
    origin,
    destination,
    departureText,
    loadText,
    intervalMi,
  );
  const issues = check.issues;
  // The pressed spacing follows the trip, not a pending form choice.
  const pressedIntervalMi = planIntervalMi ?? submittedIntervalMi;
  const showMessage = (field: FieldKey) => submitAttempted || touched[field];

  function markTouched(field: FieldKey) {
    setTouched((current) => ({ ...current, [field]: true }));
  }

  function focusFirstInvalid(problems: FormIssues) {
    const field = firstInvalidField(problems, origin, destination);
    if (field === null) {
      return;
    }
    const inputId = FIELD_INPUT_IDS[field];
    // A mouse click focuses the pressed button after this handler returns, so defer
    // one frame to make the invalid field win for mouse and keyboard alike.
    window.requestAnimationFrame(() => {
      document.getElementById(inputId)?.focus();
    });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitAttempted(true);
    if (check.request !== null) {
      setSubmittedIntervalMi(intervalMi);
      onSubmit(check.request);
      return;
    }
    focusFirstInvalid(issues);
  }

  function handleInterval(next: IntervalMi) {
    // Pressing the spacing the trip already uses only re-aligns the pending choice.
    const shownIntervalMi = pressedIntervalMi;
    setIntervalMi(next);
    if (!hasPlan || next === shownIntervalMi) {
      return;
    }
    const nextCheck = checkForm(
      now,
      origin,
      destination,
      departureText,
      loadText,
      next,
    );
    if (nextCheck.request === null) {
      setSubmitAttempted(true);
      focusFirstInvalid(nextCheck.issues);
      return;
    }
    setSubmittedIntervalMi(next);
    onSubmit(nextCheck.request);
  }

  const departureMin = dateTimeInputValue(
    new Date(now.getTime() - EARLIEST_DEPARTURE_MS),
  );
  const departureMax = dateTimeInputValue(
    new Date(now.getTime() + LATEST_DEPARTURE_MS),
  );
  const departureIssue = showMessage("departure") ? issues.departure : undefined;
  const loadIssue = showMessage("load") ? issues.load : undefined;

  return (
    <form className="trip-form" onSubmit={handleSubmit} noValidate>
      <PlacePicker
        inputId="origin-input"
        label="Origin"
        placeholder="City or town"
        emptyMessage="Choose an origin."
        value={origin}
        onChange={setOrigin}
        issue={issues.origin ?? null}
        showMessage={showMessage("origin")}
        onLeave={() => markTouched("origin")}
      />
      <PlacePicker
        inputId="destination-input"
        label="Destination"
        placeholder="City or town"
        emptyMessage="Choose a destination."
        value={destination}
        onChange={setDestination}
        issue={issues.destination ?? null}
        showMessage={showMessage("destination")}
        onLeave={() => markTouched("destination")}
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
          min={departureMin}
          max={departureMax}
          value={departureText}
          aria-invalid={departureIssue !== undefined}
          aria-describedby={
            departureIssue !== undefined ? "departure-input-error" : undefined
          }
          onChange={(event) => setDepartureText(event.target.value)}
          onBlur={(event) => {
            if (!leavesToSubmit(event.relatedTarget)) {
              markTouched("departure");
            }
          }}
        />
        {departureIssue !== undefined && (
          <p
            className="field-error"
            id="departure-input-error"
            data-testid="departure-input-error"
          >
            {departureIssue}
          </p>
        )}
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
              // 0 makes the 1,000 lb steps start on round numbers; 1 lb is the floor in checkForm.
              min={0}
              max={MAX_LOAD_LB}
              step={1000}
              inputMode="numeric"
              value={loadText}
              aria-invalid={loadIssue !== undefined}
              aria-describedby={
                loadIssue !== undefined ? "load-input-error" : undefined
              }
              onChange={(event) => setLoadText(event.target.value)}
              onBlur={(event) => {
                if (!leavesToSubmit(event.relatedTarget)) {
                  markTouched("load");
                }
              }}
            />
            <span className="input-suffix" aria-hidden="true">
              lb
            </span>
          </div>
          {loadIssue !== undefined && (
            <p
              className="field-error"
              id="load-input-error"
              data-testid="load-input-error"
            >
              {loadIssue}
            </p>
          )}
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
            aria-describedby="interval-description"
          >
            {INTERVAL_CHOICES.map((miles) => (
              <button
                key={miles}
                type="button"
                data-testid={`interval-${miles}`}
                aria-pressed={pressedIntervalMi === miles}
                aria-label={`Checkpoint every ${miles} miles`}
                onClick={() => handleInterval(miles)}
              >
                {miles}
              </button>
            ))}
          </div>
        </div>

        <p className="form-note" id="interval-description">
          Choosing a spacing plans the trip again with the values in this form.
        </p>
      </div>

      <button
        type="submit"
        data-testid="plan-submit"
        className="plan-button"
        disabled={loading}
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
