import { useCallback, useEffect } from "react";
import { useBeforeUnload, useBlocker } from "react-router-dom";

export const useUnsavedEvent = (hasChanges: boolean) => {
  const blocker = useBlocker(({ currentLocation, nextLocation }) => hasChanges && (
    currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search
  ));
  useBeforeUnload(useCallback((event: BeforeUnloadEvent) => {
    if (hasChanges) {
      event.preventDefault();
      event.returnValue = "";
    }
  }, [hasChanges]));
  useEffect(() => {
    if (blocker.state === "blocked" && !hasChanges) blocker.proceed();
  }, [blocker, hasChanges]);
  return blocker;
};
