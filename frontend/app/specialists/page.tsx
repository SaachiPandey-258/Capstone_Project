"use client";

import { useState } from "react";
import { ExternalLink, LocateFixed, MapPin, Search } from "lucide-react";
import { RequireAuth } from "@/components/require-auth";
import { PageHeading } from "@/components/ui";
import { api } from "@/lib/api";
import { specialistUnavailableMessage, validateSpecialistLocation } from "@/lib/specialists";
import type { SpecialistProvider, SpecialistSearch } from "@/lib/types";

function SpecialistSearchPage() {
  const [location, setLocation] = useState("");
  const [category, setCategory] = useState("neurology");
  const [radius, setRadius] = useState("25");
  const [coordinates, setCoordinates] = useState<{ latitude: number; longitude: number } | null>(null);
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [providers, setProviders] = useState<SpecialistProvider[] | null>(null);
  const [attribution, setAttribution] = useState("");

  function useLocation() {
    setMessage("");
    setError(false);
    setProviders(null);
    setAttribution("");
    setCoordinates(null);
    if (!navigator.geolocation) {
      setError(true);
      setMessage("Location services are not available in this browser. Enter a city or postal code instead.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setCoordinates({ latitude: coords.latitude, longitude: coords.longitude });
        setLocation("Current location");
      },
      (reason) => {
        setError(true);
        setMessage(reason.code === reason.PERMISSION_DENIED
          ? "Location permission was denied. You can enter a city or postal code instead."
          : "We could not determine your location. Enter a city or postal code instead.");
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
    );
  }

  async function search(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const invalid = validateSpecialistLocation(location);
    if (invalid) {
      setError(true);
      setMessage(invalid);
      setProviders(null);
      setAttribution("");
      return;
    }
    setSearching(true);
    setMessage("");
    setError(false);
    setProviders(null);
    setAttribution("");
    const query: SpecialistSearch = {
      location: location.trim(),
      category,
      radius: Number(radius),
      ...(coordinates || {}),
    };
    try {
      const result = await api.specialists(query);
      setProviders(result.providers);
      setAttribution(result.attribution);
      setMessage(result.providers.length
        ? `${result.providers.length} listing${result.providers.length === 1 ? "" : "s"} found.`
        : "No matching listings were found within this radius.");
    } catch (caught) {
      setError(true);
      setMessage(specialistUnavailableMessage(caught));
      setProviders(null);
    } finally {
      setSearching(false);
    }
  }

  return <main className="private-page content-width">
    <PageHeading eyebrow="Care directory" title="Find a specialist">Search by city or postal code. Location permission is optional and is requested only if you choose to use it.</PageHeading>
    <section className="search-card">
      <form className="specialist-form" onSubmit={(event) => void search(event)}>
        <div className="location-field"><label htmlFor="location">City or postal code</label><div className="input-with-icon"><MapPin size={18} aria-hidden="true" /><input id="location" autoComplete="off" value={location} onChange={(event) => { setLocation(event.target.value); setCoordinates(null); setProviders(null); setMessage(""); setAttribution(""); }} placeholder="e.g. Portland or 97201" /></div></div>
        <button className="button button-outline geo-button" type="button" onClick={useLocation}><LocateFixed size={17} /> Use my location</button>
        <div><label htmlFor="category">Specialty</label><select id="category" value={category} onChange={(event) => { setCategory(event.target.value); setProviders(null); setMessage(""); setAttribution(""); }}><option value="neurology">Neurology</option><option value="movement-disorders">Movement disorders</option><option value="physical-therapy">Physical therapy</option></select></div>
        <div><label htmlFor="radius">Search radius</label><select id="radius" value={radius} onChange={(event) => { setRadius(event.target.value); setProviders(null); setMessage(""); setAttribution(""); }}><option value="10">10 miles</option><option value="25">25 miles</option><option value="50">50 miles</option><option value="100">100 miles</option></select></div>
        <button className="button" type="submit" disabled={searching}><Search size={17} />{searching ? "Searching…" : "Search"}</button>
      </form>
      {message && <div className={error ? "provider-unavailable" : "provider-empty"} role={error ? "alert" : "status"}><strong>{error ? "Search unavailable" : providers?.length ? "Search complete" : "No matching listings"}</strong><p>{message}</p>{error && <p className="field-hint">No sample or placeholder providers are displayed.</p>}</div>}
      {providers && providers.length > 0 && <div className="provider-results" aria-label="OpenStreetMap specialist listings">
        {providers.map((provider) => <article className="provider-card" key={provider.id}>
          <div className="provider-card-heading"><div><h2>{provider.name}</h2><p>{provider.address || "Address not listed"}</p></div><span>{provider.distance_miles} mi</span></div>
          <div className="provider-links">
            {provider.phone && <a href={`tel:${provider.phone}`}>{provider.phone}</a>}
            {provider.website && <a href={provider.website} target="_blank" rel="noreferrer">Website <ExternalLink size={14} aria-hidden="true" /></a>}
            <a href={provider.osm_url} target="_blank" rel="noreferrer">OpenStreetMap <ExternalLink size={14} aria-hidden="true" /></a>
          </div>
        </article>)}
      </div>}
      {attribution && <p className="osm-attribution">Data: {attribution}, licensed under the <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">Open Database Licence</a>.</p>}
    </section>
    <div className="provider-note provider-limitation">Listings are drawn from community-maintained OpenStreetMap tags and may be incomplete or out of date. They are not endorsements or a substitute for contacting a provider to confirm services and availability.</div>
  </main>;
}

export default function SpecialistsPage() {
  return <RequireAuth><SpecialistSearchPage /></RequireAuth>;
}
