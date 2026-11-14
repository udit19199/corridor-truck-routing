import { useState, type FormEvent } from "react";
import type { IntervalMi, Place, PlanRequest } from "../api";
import { dateTimeInputValue, nextHourInputValue } from "../lib/format";
import PlacePicker, { leavesToFormButton } from "./PlacePicker";
import {
  EARLIEST_DEPARTURE_MS,
  FIELD_INPUT_IDS,
  LATEST_DEPARTURE_MS,
  MAX_LOAD_LB,
  checkForm,
  firstInvalidField,
  type FieldKey,
  type FormIssues,
} from "../lib/tripFormCheck";

const INTERVAL_CHOICES = [10, 25, 50] as const;
const DEFAULT_LOAD_LB = "20000";

interface TripFormProps {
  loading: boolean;
  /** Interval of the trip on screen, or null before the first plan. */
  planIntervalMi: IntervalMi | null;
  onSubmit: (request: PlanRequest) => void;
  /** Drops a replan still in flight, so the trip on screen stays. */
  onCancel: () => void;
}

export default function TripForm({
  loading,
  planIntervalMi,
  onSubmit,
  onCancel,
}: TripFormProps) {
  const [origin, setOrigin] = useState<Place | null>(null);
  const [destination, setDestination] = useState<Place | null>(null);
  const [departureText, setDepartureText] = useState(nextHourInputValue);
  const [loadText, setLoadText] = useState(DEFAULT_LOAD_LB);
  const [intervalMi, setIntervalMi] = useState<IntervalMi>(25);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [touched, setTouched] = useState<Record<FieldKey, boolean>>({
    origin: false,
    destination: false,
    departure: false,
    load: false,
  });

  // Read per render so the departure window follows the clock, not the first paint.
  const now = new Date();
  const check = (interval: IntervalMi, at = new Date()) =>
    checkForm(at, origin, destination, departureText, loadText, interval);
  const { issues } = check(intervalMi, now);
  // With a trip on screen the pressed spacing is that trip's, never the pending choice.
  const pressedIntervalMi = planIntervalMi ?? intervalMi;
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
    if (loading) {
      return;
    }
    setSubmitAttempted(true);
    const submitted = check(intervalMi);
    if (submitted.request !== null) {
      onSubmit(submitted.request);
      return;
    }
    focusFirstInvalid(submitted.issues);
  }

  function handleInterval(next: IntervalMi) {
    setIntervalMi(next);
    if (planIntervalMi === null) {
      return;
    }
    if (next === planIntervalMi) {
      // Back to the spacing on screen: a replan for another spacing must not land after it.
      onCancel();
      return;
    }
    const nextCheck = check(next);
    if (nextCheck.request === null) {
      // The trip on screen keeps its spacing, so explain why nothing was sent.
      setSubmitAttempted(true);
      return;
    }
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
        label="From"
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
        label="To"
        placeholder="City or town"
        emptyMessage="Choose a destination."
        value={destination}
        onChange={setDestination}
        issue={issues.destination ?? null}
        showMessage={showMessage("destination")}
        onLeave={() => markTouched("destination")}
      />

      <div className="field">
        <label htmlFor="departure-input">Leaving</label>
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
            if (!leavesToFormButton(event.relatedTarget)) {
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
              // Step from 0 so arrow keys keep round thousands; checkForm holds
              // the 1 lb floor the server enforces.
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
                if (!leavesToFormButton(event.relatedTarget)) {
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
            Checkpoint every
            <span className="field-note">mi</span>
          </span>
          <div
            className="segmented"
            role="group"
            aria-labelledby="interval-label"
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
      </div>

      <button
        type="submit"
        data-testid="plan-submit"
        className="plan-button"
        aria-disabled={loading}
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
