import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { geocode, type Place } from "./api";

type SearchState =
  | { status: "idle" | "searching" | "failed" }
  | { status: "done"; options: Place[] };

/**
 * Debounced place search plus the listbox state that follows from it. A query
 * that matches the chosen place, or is too short, clears the list. An answer opens
 * the list only while the field has focus, so it never covers a field the user moved to.
 */
function usePlaceSearch(inputId: string, query: string, value: Place | null) {
  const [placeSearch, setPlaceSearch] = useState<SearchState>({
    status: "idle",
  });
  const [listOpen, setListOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const cancelPendingRef = useRef<(() => void) | null>(null);

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

  /**
   * Escape dismisses the list, including an answer that has not arrived yet. Matches
   * already shown stay, so ArrowDown or a refocus can bring them back.
   */
  function dismissSearch() {
    cancelPendingRef.current?.();
    setPlaceSearch((current) =>
      current.status === "searching" ? { status: "idle" } : current,
    );
    setListOpen(false);
    setActiveIndex(-1);
  }

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
    dismissSearch,
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
 * Leaving a field for one of the form's buttons (an interval or submit) must not
 * show the field's message on the blur: the message would push the buttons down
 * between mousedown and mouseup, and the click would be lost. Submit shows the
 * messages itself; an interval click is not a judgement on the field yet.
 */
export function leavesToFormButton(target: EventTarget | null): boolean {
  return target instanceof HTMLButtonElement && target.closest("form") !== null;
}

interface ComboboxKeys {
  openList: () => void;
  closeList: () => void;
  dismiss: () => void;
  stepActive: (delta: 1 | -1) => void;
  /** True when Enter was handled here: a place was chosen or a search is still pending. */
  chooseActive: () => boolean;
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
    if (keys.chooseActive()) {
      event.preventDefault();
    }
    return;
  }
  if (key === "Escape") {
    keys.dismiss();
    return;
  }
  if (key === "Tab") {
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
  const {
    placeSearch,
    listOpen,
    setListOpen,
    activeIndex,
    setActiveIndex,
    resetSearch,
    dismissSearch,
  } = usePlaceSearch(inputId, query, value);
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
      openList: () => {
        setListOpen(true);
        setActiveIndex(options.length > 0 ? 0 : -1);
      },
      closeList: () => {
        setListOpen(false);
        setActiveIndex(-1);
      },
      dismiss: dismissSearch,
      stepActive: (delta) =>
        setActiveIndex((current) =>
          nextActiveIndex(current, delta, options.length),
        ),
      chooseActive: () => {
        const place = activePlace(options, activeIndex);
        if (place !== null) {
          choose(place);
          return true;
        }
        // Enter submits only once the search has answered with nothing to choose.
        return placeSearch.status !== "done" && placeSearch.status !== "failed";
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
            if (!leavesToFormButton(event.relatedTarget)) {
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
