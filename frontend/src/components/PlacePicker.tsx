import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { geocode, type Place } from "../api";

type SearchState =
  | { status: "idle" | "searching" | "failed" }
  | { status: "done"; options: Place[] };

/** What screen readers announce, and the list's placeholder when it has no options. */
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

/**
 * Leaving a field for one of the form's buttons (an interval or submit) must not
 * show the field's message on blur: the message would push the buttons down
 * between mousedown and mouseup, and the click would be lost.
 */
export function leavesToFormButton(target: EventTarget | null): boolean {
  return target instanceof HTMLButtonElement && target.closest("form") !== null;
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

export default function PlacePicker({
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
  const [placeSearch, setPlaceSearch] = useState<SearchState>({ status: "idle" });
  const [listOpen, setListOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const cancelPendingRef = useRef<(() => void) | null>(null);

  // Debounced search. A query matching the chosen place, or too short, clears the
  // list; an answer opens it only while the field still has focus.
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2 || (value !== null && trimmed === value.label)) {
      setPlaceSearch({ status: "idle" });
      setListOpen(false);
      return;
    }

    const controller = new AbortController();
    const openIfFocused = () => {
      if (document.activeElement?.id === inputId) {
        setListOpen(true);
      }
    };
    const timer = window.setTimeout(() => {
      setPlaceSearch({ status: "searching" });
      geocode(trimmed, controller.signal)
        .then((options) => {
          if (controller.signal.aborted) {
            return;
          }
          setPlaceSearch({ status: "done", options });
          setActiveIndex(options.length > 0 ? 0 : -1);
          openIfFocused();
        })
        .catch(() => {
          if (controller.signal.aborted) {
            return;
          }
          setPlaceSearch({ status: "failed" });
          openIfFocused();
        });
    }, 250);

    const cancelPending = () => {
      window.clearTimeout(timer);
      controller.abort();
    };
    cancelPendingRef.current = cancelPending;
    return cancelPending;
  }, [inputId, query, value]);

  const options = placeSearch.status === "done" ? placeSearch.options : [];
  const listShown = listOpen && (options.length > 0 || placeSearch.status !== "idle");
  const statusText = searchStatusText(placeSearch, query);

  let message: string | null = null;
  if (showMessage) {
    if (issue !== null) {
      message = issue;
    } else if (value === null) {
      message = query.trim() === "" ? emptyMessage : "Pick a place from the list.";
    }
  }

  function resetSearch(status: "idle" | "searching" = "idle") {
    setPlaceSearch({ status });
    setActiveIndex(-1);
  }

  /** Escape drops the list, including a search that has not answered yet. */
  function dismissSearch() {
    cancelPendingRef.current?.();
    setPlaceSearch((current) =>
      current.status === "searching" ? { status: "idle" } : current,
    );
    setListOpen(false);
    setActiveIndex(-1);
  }

  function choose(place: Place) {
    setQuery(place.label);
    onChange(place);
    setListOpen(false);
    resetSearch();
  }

  function handleQueryChange(next: string) {
    setQuery(next);
    // Old matches must not stay choosable while the search for the new text waits,
    // and Enter must wait for that search rather than submit the form.
    resetSearch(next.trim().length >= 2 ? "searching" : "idle");
    if (value !== null && next !== value.label) {
      onChange(null);
    }
    setListOpen(true);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const { key } = event;
    if (key === "ArrowDown" || key === "ArrowUp") {
      event.preventDefault();
      if (!listShown) {
        setListOpen(true);
        setActiveIndex(options.length > 0 ? 0 : -1);
        return;
      }
      const delta = key === "ArrowDown" ? 1 : -1;
      setActiveIndex((current) =>
        delta === 1
          ? Math.min(current + 1, options.length - 1)
          : Math.max(current - 1, 0),
      );
      return;
    }
    if (key === "Enter" && listShown) {
      const place = options[activeIndex >= 0 ? activeIndex : 0] ?? null;
      if (place !== null) {
        choose(place);
        event.preventDefault();
      } else if (placeSearch.status !== "done" && placeSearch.status !== "failed") {
        // Enter submits only once the search has answered with nothing to choose.
        event.preventDefault();
      }
      return;
    }
    if (key === "Escape") {
      dismissSearch();
      return;
    }
    if (key === "Tab") {
      setListOpen(false);
      setActiveIndex(-1);
    }
  }

  const listId = `${inputId}-listbox`;
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
          aria-activedescendant={
            listOpen && activeIndex >= 0
              ? `${inputId}-option-${activeIndex}`
              : undefined
          }
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
              setActiveIndex(options.length > 0 ? 0 : -1);
            }
          }}
          onKeyDown={handleKeyDown}
          onBlur={(event) => {
            window.setTimeout(() => setListOpen(false), 120);
            if (!leavesToFormButton(event.relatedTarget)) {
              onLeave();
            }
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
                // A click must not blur the input before it lands.
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => choose(place)}
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
