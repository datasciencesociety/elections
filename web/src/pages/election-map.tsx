import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router";
import { Map, useMap } from "@/components/ui/map";
import MapLibreGL from "maplibre-gl";

interface Election {
  id: number;
  name: string;
  date: string;
  type: string;
}

interface PartyEntry {
  party_id: number;
  name: string;
  color: string;
  votes: number;
  pct: number;
}

interface MunicipalityResult {
  id: number;
  name: string;
  geo: { type: string; coordinates: unknown };
  total_votes: number;
  winner: {
    party_id: number;
    name: string;
    color: string;
    votes: number;
    pct: number;
  } | null;
  parties: PartyEntry[];
}

interface GeoResultsResponse {
  election: Election;
  municipalities: MunicipalityResult[];
}

const BULGARIA_CENTER: [number, number] = [25.5, 42.7];
const BULGARIA_ZOOM = 7;
const LAYER_ID = "municipalities-fill";
const BORDER_LAYER_ID = "municipalities-border";
const SOURCE_ID = "municipalities";
const NO_WINNER_COLOR = "#CCCCCC";

function buildFeatureCollection(municipalities: MunicipalityResult[]) {
  return {
    type: "FeatureCollection" as const,
    features: municipalities.map((m) => ({
      type: "Feature" as const,
      geometry: m.geo,
      properties: {
        id: m.id,
        name: m.name,
        total_votes: m.total_votes,
        winner_color: m.winner ? m.winner.color : NO_WINNER_COLOR,
        winner_name: m.winner ? m.winner.name : null,
        winner_votes: m.winner ? m.winner.votes : 0,
        winner_pct: m.winner ? m.winner.pct : 0,
        // Serialize parties as JSON string for feature property storage
        parties_json: JSON.stringify(m.parties),
        has_winner: m.winner !== null,
      },
    })),
  };
}

// Child component that manages MapLibre layers using the map context
function ChoroplethLayer({
  municipalities,
  onMunicipalityClick,
}: {
  municipalities: MunicipalityResult[];
  onMunicipalityClick: (muni: {
    name: string;
    total_votes: number;
    parties: PartyEntry[];
    lngLat: [number, number];
  }) => void;
}) {
  const { map, isLoaded } = useMap();
  const onClickRef = useRef(onMunicipalityClick);
  onClickRef.current = onMunicipalityClick;

  useEffect(() => {
    if (!map || !isLoaded || municipalities.length === 0) return;

    const featureCollection = buildFeatureCollection(municipalities);

    // Add or update source
    const existing = map.getSource(SOURCE_ID);
    if (existing) {
      (existing as MapLibreGL.GeoJSONSource).setData(featureCollection as any);
    } else {
      map.addSource(SOURCE_ID, {
        type: "geojson",
        data: featureCollection as any,
      });
    }

    // Add fill layer if not present
    if (!map.getLayer(LAYER_ID)) {
      map.addLayer({
        id: LAYER_ID,
        type: "fill",
        source: SOURCE_ID,
        paint: {
          "fill-color": ["get", "winner_color"],
          "fill-opacity": 0.7,
        },
      });
    }

    // Add border layer if not present
    if (!map.getLayer(BORDER_LAYER_ID)) {
      map.addLayer({
        id: BORDER_LAYER_ID,
        type: "line",
        source: SOURCE_ID,
        paint: {
          "line-color": "rgba(0,0,0,0.3)",
          "line-width": 0.5,
        },
      });
    }

    return () => {
      if (map.getLayer(BORDER_LAYER_ID)) map.removeLayer(BORDER_LAYER_ID);
      if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
    };
  }, [map, isLoaded, municipalities]);

  // Click handler
  useEffect(() => {
    if (!map || !isLoaded) return;

    const handleClick = (e: MapLibreGL.MapMouseEvent) => {
      const features = map.queryRenderedFeatures(e.point, {
        layers: [LAYER_ID],
      });
      if (!features.length) return;

      const props = features[0].properties as any;
      const parties: PartyEntry[] = props.parties_json
        ? JSON.parse(props.parties_json)
        : [];

      onClickRef.current({
        name: props.name,
        total_votes: props.total_votes,
        parties,
        lngLat: [e.lngLat.lng, e.lngLat.lat],
      });
    };

    const handleMouseEnter = () => {
      map.getCanvas().style.cursor = "pointer";
    };

    const handleMouseLeave = () => {
      map.getCanvas().style.cursor = "";
    };

    map.on("click", LAYER_ID, handleClick);
    map.on("mouseenter", LAYER_ID, handleMouseEnter);
    map.on("mouseleave", LAYER_ID, handleMouseLeave);

    return () => {
      map.off("click", LAYER_ID, handleClick);
      map.off("mouseenter", LAYER_ID, handleMouseEnter);
      map.off("mouseleave", LAYER_ID, handleMouseLeave);
    };
  }, [map, isLoaded]);

  return null;
}

interface PopupData {
  name: string;
  total_votes: number;
  parties: PartyEntry[];
  lngLat: [number, number];
}

function MunicipalityPopup({
  data,
  onClose,
}: {
  data: PopupData | null;
  onClose: () => void;
}) {
  const { map, isLoaded } = useMap();
  const popupRef = useRef<MapLibreGL.Popup | null>(null);

  useEffect(() => {
    if (!map || !isLoaded) return;
    return () => {
      popupRef.current?.remove();
      popupRef.current = null;
    };
  }, [map, isLoaded]);

  useEffect(() => {
    if (!map || !isLoaded) return;

    // Remove existing popup
    popupRef.current?.remove();
    popupRef.current = null;

    if (!data) return;

    const containerEl = document.createElement("div");
    containerEl.style.cssText = "padding:8px;min-width:220px;max-width:300px;font-family:sans-serif;font-size:13px;";

    const title = document.createElement("div");
    title.style.cssText = "font-weight:bold;font-size:14px;margin-bottom:4px;";
    title.textContent = data.name;
    containerEl.appendChild(title);

    const totalEl = document.createElement("div");
    totalEl.style.cssText = "color:#666;margin-bottom:8px;";
    totalEl.textContent = `Total votes: ${data.total_votes.toLocaleString()}`;
    containerEl.appendChild(totalEl);

    if (data.parties.length === 0) {
      const noData = document.createElement("div");
      noData.style.cssText = "color:#999;font-style:italic;";
      noData.textContent = "No vote data for this election";
      containerEl.appendChild(noData);
    } else {
      const maxVotes = data.parties[0]?.votes ?? 1;
      for (const party of data.parties.slice(0, 10)) {
        const row = document.createElement("div");
        row.style.cssText = "margin-bottom:6px;";

        const label = document.createElement("div");
        label.style.cssText = "display:flex;justify-content:space-between;margin-bottom:2px;";
        label.innerHTML = `
          <span style="display:flex;align-items:center;gap:4px;overflow:hidden;">
            <span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${party.color};flex-shrink:0;"></span>
            <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:160px;" title="${party.name}">${party.name}</span>
          </span>
          <span style="white-space:nowrap;margin-left:8px;">${party.pct.toFixed(1)}%</span>
        `;
        row.appendChild(label);

        const bar = document.createElement("div");
        bar.style.cssText = "height:4px;background:#eee;border-radius:2px;";
        const fill = document.createElement("div");
        const barWidth = maxVotes > 0 ? (party.votes / maxVotes) * 100 : 0;
        fill.style.cssText = `height:4px;background:${party.color};border-radius:2px;width:${barWidth}%;`;
        bar.appendChild(fill);
        row.appendChild(bar);

        const votes = document.createElement("div");
        votes.style.cssText = "color:#888;font-size:11px;margin-top:1px;";
        votes.textContent = `${party.votes.toLocaleString()} votes`;
        row.appendChild(votes);

        containerEl.appendChild(row);
      }
      if (data.parties.length > 10) {
        const more = document.createElement("div");
        more.style.cssText = "color:#999;font-size:11px;margin-top:4px;";
        more.textContent = `+${data.parties.length - 10} more parties`;
        containerEl.appendChild(more);
      }
    }

    const popup = new MapLibreGL.Popup({ closeButton: true, maxWidth: "320px" })
      .setLngLat(data.lngLat)
      .setDOMContent(containerEl)
      .addTo(map);

    popup.on("close", onClose);
    popupRef.current = popup;
  }, [map, isLoaded, data, onClose]);

  return null;
}

export default function ElectionMap() {
  const { electionId } = useParams<{ electionId: string }>();
  const navigate = useNavigate();

  const [elections, setElections] = useState<Election[]>([]);
  const [geoData, setGeoData] = useState<GeoResultsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [popupData, setPopupData] = useState<PopupData | null>(null);

  // Fetch elections list for selector
  useEffect(() => {
    fetch("/api/elections")
      .then((res) => res.json())
      .then(setElections)
      .catch(() => {});
  }, []);

  // Fetch geo results for current election
  useEffect(() => {
    if (!electionId) return;
    setLoading(true);
    setError(null);
    setGeoData(null);
    setPopupData(null);

    fetch(`/api/elections/${electionId}/results/geo`)
      .then((res) => {
        if (res.status === 404) throw new Error("Election not found");
        if (res.status === 400) throw new Error("Invalid election ID");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: GeoResultsResponse) => setGeoData(data))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [electionId]);

  const handleElectionChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const newId = e.target.value;
      if (newId !== electionId) {
        setPopupData(null);
        navigate(`/map/${newId}`);
      }
    },
    [electionId, navigate]
  );

  const handleMunicipalityClick = useCallback(
    (muni: { name: string; total_votes: number; parties: PartyEntry[]; lngLat: [number, number] }) => {
      setPopupData(muni);
    },
    []
  );

  const handlePopupClose = useCallback(() => {
    setPopupData(null);
  }, []);

  return (
    <div style={{ position: "relative", width: "100%", height: "100vh", display: "flex", flexDirection: "column" }}>
      {/* Top bar */}
      <div
        style={{
          position: "absolute",
          top: 10,
          left: 10,
          zIndex: 10,
          background: "rgba(255,255,255,0.95)",
          padding: "8px 12px",
          borderRadius: 6,
          boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <a href="/" style={{ color: "#555", textDecoration: "none", fontSize: 13 }}>
          Back
        </a>
        {geoData && (
          <span style={{ fontWeight: "bold", fontSize: 14 }}>
            {geoData.election.name}
          </span>
        )}
        {loading && !geoData && (
          <span style={{ fontSize: 13, color: "#888" }}>Loading...</span>
        )}
        {error && (
          <span style={{ fontSize: 13, color: "#c00" }}>{error}</span>
        )}
      </div>

      {/* Election selector */}
      {elections.length > 0 && (
        <div
          style={{
            position: "absolute",
            top: 10,
            right: 10,
            zIndex: 10,
            background: "rgba(255,255,255,0.95)",
            padding: "6px 8px",
            borderRadius: 6,
            boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
          }}
        >
          <select
            value={electionId ?? ""}
            onChange={handleElectionChange}
            style={{ fontSize: 13, border: "none", background: "transparent", cursor: "pointer" }}
          >
            {elections.map((e) => (
              <option key={e.id} value={String(e.id)}>
                {e.name} ({e.date})
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Map */}
      <div style={{ flex: 1, width: "100%", height: "100%" }}>
        <Map
          center={BULGARIA_CENTER}
          zoom={BULGARIA_ZOOM}
          className="h-full w-full"
        >
          {geoData && geoData.municipalities.length > 0 && (
            <>
              <ChoroplethLayer
                municipalities={geoData.municipalities}
                onMunicipalityClick={handleMunicipalityClick}
              />
              <MunicipalityPopup
                data={popupData}
                onClose={handlePopupClose}
              />
            </>
          )}
        </Map>
      </div>
    </div>
  );
}
