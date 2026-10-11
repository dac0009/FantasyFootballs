import { Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { ErrorState, Loading } from "./components/primitives";
import { useMeta } from "./lib/data";
import Home from "./pages/Home";
import CurrentSeason from "./pages/CurrentSeason";
import SeasonIndex from "./pages/SeasonIndex";
import Season from "./pages/Season";
import Week from "./pages/Week";
import Records from "./pages/Records";
import Owners from "./pages/Owners";
import Owner from "./pages/Owner";
import HeadToHead from "./pages/HeadToHead";
import Drafts from "./pages/Drafts";
import Glossary from "./pages/Glossary";
import { Navigate } from "react-router-dom";
import NotFound from "./pages/NotFound";

export default function App() {
  const meta = useMeta();

  if (meta.state === "loading") {
    return (
      <Layout meta={null}>
        <Loading what="the league" />
      </Layout>
    );
  }
  if (meta.state === "error") {
    return (
      <Layout meta={null}>
        <ErrorState error={meta.error} what="This league archive" />
      </Layout>
    );
  }

  return (
    <Layout meta={meta.data}>
      <Routes>
        <Route path="/" element={<Home meta={meta.data} />} />
        <Route path="/season" element={<CurrentSeason meta={meta.data} />} />
        <Route path="/seasons" element={<SeasonIndex />} />
        <Route path="/seasons/:year" element={<Season />} />
        <Route path="/seasons/:year/weeks/:week" element={<Week />} />
        <Route path="/records" element={<Records />} />
        <Route path="/owners" element={<Owners />} />
        <Route path="/owners/:ownerId" element={<Owner />} />
        <Route path="/head-to-head" element={<HeadToHead />} />
        <Route path="/drafts" element={<Drafts meta={meta.data} />} />
        <Route path="/glossary" element={<Glossary meta={meta.data} />} />
        <Route path="/methodology" element={<Navigate to="/glossary" replace />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Layout>
  );
}
