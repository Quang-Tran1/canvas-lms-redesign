export default function ProgressBar() {
  return (
    <div>
      <h3 style="margin-left: 8px; margin-bottom: 2px; font-weight: 700;">
        25%
      </h3>
      <div className="blms-progressbar">
        <div className="blms-progressbar__segment first-segment" id="completed">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            stroke-width="3"
            stroke="currentColor"
            class="size-6"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="m4.5 12.75 6 6 9-13.5"
            />
          </svg>
        </div>
        <div className="blms-progressbar__segment" id="class1"></div>
        <div className="blms-progressbar__segment" id="class2"></div>
        <div className="blms-progressbar__segment" id="class3"></div>
      </div>
    </div>
  );
}
