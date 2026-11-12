import { useCallback, useEffect, useRef, useState } from "react";
import { planTrip, type PlanRequest, type PlanResponse } from "./api";

const PLAN_TIMEOUT_MS = 30_000;

export type RequestState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string };

const IDLE: RequestState = { status: "idle" };

function errorMessage(error: unknown): string {
  if (
    error instanceof DOMException &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  ) {
    return "Planning took too long. Try again.";
  }
  if (error instanceof TypeError) {
    return "Could not reach the server. Check your connection and try again.";
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "The trip could not be planned.";
}

/**
 * One plan request at a time, with a 30 second timeout. A newer request or `cancel`
 * aborts the one in flight, and an aborted request never reports.
 */
export function usePlanRequest(
  onPlan: (plan: PlanResponse, request: PlanRequest) => void,
) {
  const [request, setRequest] = useState<RequestState>(IDLE);
  const requestRef = useRef<AbortController | null>(null);

  const runPlan = useCallback(
    (nextRequest: PlanRequest) => {
      requestRef.current?.abort();
      const controller = new AbortController();
      requestRef.current = controller;
      setRequest({ status: "loading" });

      const signal = AbortSignal.any([
        controller.signal,
        AbortSignal.timeout(PLAN_TIMEOUT_MS),
      ]);
      planTrip(nextRequest, signal)
        .then((plan) => {
          // A superseded or timed out request must not replace what is on screen.
          if (controller.signal.aborted) {
            return;
          }
          requestRef.current = null;
          onPlan(plan, nextRequest);
          setRequest(IDLE);
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) {
            return;
          }
          requestRef.current = null;
          setRequest({ status: "error", message: errorMessage(error) });
        });
    },
    [onPlan],
  );

  useEffect(() => {
    return () => {
      requestRef.current?.abort();
    };
  }, []);

  const cancel = useCallback(() => {
    if (requestRef.current === null) {
      return;
    }
    requestRef.current.abort();
    requestRef.current = null;
    setRequest(IDLE);
  }, []);

  return { request, runPlan, cancel };
}
