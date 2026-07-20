import homeIcon from "../assets/house-solid.png";

export default function StudioBreadcrumb({ studioLabel, onHome }) {
  return (
    <nav className="studio-welcome studio-breadcrumb" aria-label="Breadcrumb">
      <button type="button" className="studio-breadcrumb-link" onClick={onHome} aria-label="Home">
        <img src={homeIcon} alt="" className="studio-breadcrumb-home-icon" draggable={false} />
      </button>
      <span className="studio-breadcrumb-sep" aria-hidden>
        &gt;
      </span>
      <span className="studio-breadcrumb-current" aria-current="page">
        {studioLabel}
      </span>
    </nav>
  );
}
