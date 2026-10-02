import { useEffect, useState } from 'react';
import { businessDate } from './projectDates';
/** Refresh at minute boundaries (including LA midnight), and immediately after a hidden tab resumes. */
export function useBusinessDate(): string {
  const [day, setDay] = useState(() => businessDate());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {setDay(businessDate()); clearTimeout(timer); timer = setTimeout(tick, 60000 - Date.now() % 60000 + 5);};
    tick(); window.addEventListener('focus', tick); document.addEventListener('visibilitychange', tick);
    return () => {clearTimeout(timer); window.removeEventListener('focus', tick); document.removeEventListener('visibilitychange', tick);};
  }, []);
  return day;
}
