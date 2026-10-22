"use client";

import React, { useEffect, useState } from "react";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge, Input, Label, Textarea } from "@/components/ui/primitives";
import { toast } from "sonner";

export default function ProfilePage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [fullName, setFullName] = useState("");
  const [title, setTitle] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [location, setLocation] = useState("");
  const [yearsExp, setYearsExp] = useState(0);
  const [summary, setSummary] = useState("");
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [portfolioUrl, setPortfolioUrl] = useState("");

  const [techSkills, setTechSkills] = useState<string[]>([]);
  const [newTechSkill, setNewTechSkill] = useState("");

  const [softSkills, setSoftSkills] = useState<string[]>([]);
  const [newSoftSkill, setNewSoftSkill] = useState("");

  const [sectors, setSectors] = useState<string[]>([]);
  const [newSector, setNewSector] = useState("");

  const [languages, setLanguages] = useState<
    Array<{ language: string; level: string }>
  >([]);
  const [workExp, setWorkExp] = useState<Array<any>>([]);
  const [education, setEducation] = useState<Array<any>>([]);
  const [certifications, setCertifications] = useState<Array<any>>([]);
  const [projects, setProjects] = useState<Array<any>>([]);

  const [targetLocations, setTargetLocations] = useState<string[]>([
    "Morocco",
    "France",
    "Europe",
    "Remote",
  ]);
  const [remotePref, setRemotePref] = useState<
    "any" | "remote_only" | "hybrid" | "onsite"
  >("any");

  useEffect(() => {
    fetch("/api/profile")
      .then((r) => r.json())
      .then((d) => {
        if (d.profile) {
          const p = d.profile;
          setFullName(p.full_name || "");
          setTitle(p.professional_title || "");
          setEmail(p.email || "");
          setPhone(p.phone || "");
          setLocation(p.location || "");
          setYearsExp(Number(p.years_of_experience ?? 0));
          setSummary(p.summary || "");
          setLinkedinUrl(p.linkedin_url || "");
          setPortfolioUrl(p.portfolio_url || "");
          setTechSkills(p.technical_skills ?? []);
          setSoftSkills(p.soft_skills ?? []);
          setSectors(p.sectors ?? []);
          setLanguages(p.languages ?? []);
          setWorkExp(p.work_experience ?? []);
          setEducation(p.education ?? []);
          setCertifications(p.certifications ?? []);
          setProjects(p.projects ?? []);
        }
        if (d.preferences) {
          setTargetLocations(
            d.preferences.target_locations ?? [
              "Morocco",
              "France",
              "Europe",
              "Remote",
            ]
          );
          setRemotePref(d.preferences.remote_preference ?? "any");
        }
      })
      .catch(() => toast.error("Failed to load profile"))
      .finally(() => setLoading(false));
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: fullName,
          professional_title: title,
          phone,
          location,
          years_of_experience: Number(yearsExp) || 0,
          summary,
          linkedin_url: linkedinUrl,
          portfolio_url: portfolioUrl,
          technical_skills: techSkills,
          technologies: techSkills,
          soft_skills: softSkills,
          sectors,
          languages: languages.filter((l) => l.language.trim()),
          work_experience: workExp.filter(
            (w) => w.company?.trim() || w.title?.trim()
          ),
          education: education.filter(
            (ed) => ed.institution?.trim() || ed.degree?.trim()
          ),
          certifications: certifications.filter((c) => c.name?.trim()),
          projects: projects.filter((pr) => pr.name?.trim()),
          preferences: {
            target_locations: targetLocations,
            preferred_sectors: sectors,
            remote_preference: remotePref,
          },
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to update profile.");
        return;
      }
      toast.success("Professional profile saved.");
    } catch {
      toast.error("Network error while saving profile.");
    } finally {
      setSaving(false);
    }
  }

  function addTag(
    value: string,
    list: string[],
    setList: (v: string[]) => void,
    clear: () => void
  ) {
    const v = value.trim();
    if (!v) return;
    if (!list.includes(v)) setList([...list, v]);
    clear();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 gap-2 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
        <span>Loading profile...</span>
      </div>
    );
  }

  return (
    <form onSubmit={handleSave} className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold">Verified Professional Profile</h2>
          <p className="text-sm text-muted-foreground">
            Used by AI Job Matching, Email Generation, and Cover Letter PDFs.
            Review and refine any fields extracted from your CV.
          </p>
        </div>
        <Button type="submit" disabled={saving}>
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Save Profile
        </Button>
      </div>

      {/* Personal Identity */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Identity & Contact</CardTitle>
          <CardDescription>
            Displayed on generated cover letters and email signatures
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Full Name</Label>
            <Input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="e.g. Salma Bennani"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Professional Title</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Full-Stack Software Engineer / Data Analyst"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Email Address</Label>
            <Input value={email} disabled className="opacity-70" />
          </div>
          <div className="space-y-1.5">
            <Label>Phone Number</Label>
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+212 6 00 00 00 00"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Current Location</Label>
            <Input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Casablanca, Morocco"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Years of Experience</Label>
            <Input
              type="number"
              min={0}
              max={50}
              step={0.5}
              value={yearsExp}
              onChange={(e) => setYearsExp(Number(e.target.value))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>LinkedIn URL</Label>
            <Input
              value={linkedinUrl}
              onChange={(e) => setLinkedinUrl(e.target.value)}
              placeholder="https://linkedin.com/in/..."
            />
          </div>
          <div className="space-y-1.5">
            <Label>Portfolio / GitHub URL</Label>
            <Input
              value={portfolioUrl}
              onChange={(e) => setPortfolioUrl(e.target.value)}
              placeholder="https://github.com/..."
            />
          </div>
          <div className="md:col-span-2 space-y-1.5">
            <Label>Executive Summary</Label>
            <Textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="Factual overview of your core expertise, achievements, and career goals..."
            />
          </div>
        </CardContent>
      </Card>

      {/* Skills & Sectors */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Technical Skills</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Input
                placeholder="Add skill (e.g. Python, React)"
                value={newTechSkill}
                onChange={(e) => setNewTechSkill(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addTag(newTechSkill, techSkills, setTechSkills, () =>
                      setNewTechSkill("")
                    );
                  }
                }}
              />
              <Button
                type="button"
                variant="secondary"
                size="icon"
                onClick={() =>
                  addTag(newTechSkill, techSkills, setTechSkills, () =>
                    setNewTechSkill("")
                  )
                }
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {techSkills.map((s) => (
                <Badge key={s} className="gap-1.5 pr-1.5">
                  {s}
                  <button
                    type="button"
                    onClick={() =>
                      setTechSkills(techSkills.filter((x) => x !== s))
                    }
                    className="hover:text-destructive"
                  >
                    ×
                  </button>
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Soft Skills</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Input
                placeholder="Add soft skill (e.g. Agile)"
                value={newSoftSkill}
                onChange={(e) => setNewSoftSkill(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addTag(newSoftSkill, softSkills, setSoftSkills, () =>
                      setNewSoftSkill("")
                    );
                  }
                }}
              />
              <Button
                type="button"
                variant="secondary"
                size="icon"
                onClick={() =>
                  addTag(newSoftSkill, softSkills, setSoftSkills, () =>
                    setNewSoftSkill("")
                  )
                }
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {softSkills.map((s) => (
                <Badge key={s} variant="secondary" className="gap-1.5 pr-1.5">
                  {s}
                  <button
                    type="button"
                    onClick={() =>
                      setSoftSkills(softSkills.filter((x) => x !== s))
                    }
                  >
                    ×
                  </button>
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Professional Sectors</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Input
                placeholder="e.g. Software Engineering"
                value={newSector}
                onChange={(e) => setNewSector(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addTag(newSector, sectors, setSectors, () =>
                      setNewSector("")
                    );
                  }
                }}
              />
              <Button
                type="button"
                variant="secondary"
                size="icon"
                onClick={() =>
                  addTag(newSector, sectors, setSectors, () => setNewSector(""))
                }
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {sectors.map((s) => (
                <Badge key={s} variant="outline" className="gap-1.5 pr-1.5">
                  {s}
                  <button
                    type="button"
                    onClick={() => setSectors(sectors.filter((x) => x !== s))}
                  >
                    ×
                  </button>
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Target Regions & Languages */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Target Markets & Remote Preference
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {["Morocco", "France", "Europe", "International", "Remote"].map(
                (region) => {
                  const selected = targetLocations.includes(region);
                  return (
                    <button
                      key={region}
                      type="button"
                      onClick={() =>
                        setTargetLocations(
                          selected
                            ? targetLocations.filter((r) => r !== region)
                            : [...targetLocations, region]
                        )
                      }
                      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                        selected
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {region}
                    </button>
                  );
                }
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Work Arrangement</Label>
              <select
                value={remotePref}
                onChange={(e) => setRemotePref(e.target.value as any)}
                className="flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
              >
                <option value="any">Any (On-site, Hybrid, or Remote)</option>
                <option value="remote_only">Remote Only</option>
                <option value="hybrid">Hybrid Preferred</option>
                <option value="onsite">On-site Preferred</option>
              </select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Spoken Languages</CardTitle>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setLanguages([
                  ...languages,
                  { language: "", level: "Professional" },
                ])
              }
            >
              <Plus className="h-3.5 w-3.5" /> Add
            </Button>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {languages.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Add languages (e.g., French, English, Arabic) to improve
                bilingual matching.
              </p>
            )}
            {languages.map((lang, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <Input
                  placeholder="Language (e.g. French)"
                  value={lang.language}
                  onChange={(e) => {
                    const next = [...languages];
                    next[idx] = { ...lang, language: e.target.value };
                    setLanguages(next);
                  }}
                />
                <Input
                  placeholder="Level (e.g. Fluent / C1)"
                  value={lang.level}
                  onChange={(e) => {
                    const next = [...languages];
                    next[idx] = { ...lang, level: e.target.value };
                    setLanguages(next);
                  }}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() =>
                    setLanguages(languages.filter((_, i) => i !== idx))
                  }
                >
                  <Trash2 className="h-4 w-4 text-muted-foreground" />
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Work Experience */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">Work Experience</CardTitle>
            <CardDescription>
              Verified career history referenced in cover letters
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              setWorkExp([
                ...workExp,
                {
                  company: "",
                  title: "",
                  location: "",
                  startDate: "",
                  endDate: "",
                  highlights: [],
                },
              ])
            }
          >
            <Plus className="h-4 w-4" /> Add Experience
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {workExp.map((exp, idx) => (
            <div key={idx} className="rounded-xl border p-4 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Input
                  placeholder="Job Title"
                  value={exp.title || ""}
                  onChange={(e) => {
                    const next = [...workExp];
                    next[idx] = { ...exp, title: e.target.value };
                    setWorkExp(next);
                  }}
                />
                <Input
                  placeholder="Company"
                  value={exp.company || ""}
                  onChange={(e) => {
                    const next = [...workExp];
                    next[idx] = { ...exp, company: e.target.value };
                    setWorkExp(next);
                  }}
                />
                <div className="flex gap-2">
                  <Input
                    placeholder="Dates (e.g. 2023 - Present)"
                    value={exp.startDate || ""}
                    onChange={(e) => {
                      const next = [...workExp];
                      next[idx] = { ...exp, startDate: e.target.value };
                      setWorkExp(next);
                    }}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() =>
                      setWorkExp(workExp.filter((_, i) => i !== idx))
                    }
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
              <Textarea
                placeholder="Key achievements (one per line)"
                value={(exp.highlights ?? []).join("\n")}
                onChange={(e) => {
                  const next = [...workExp];
                  next[idx] = {
                    ...exp,
                    highlights: e.target.value
                      .split("\n")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  };
                  setWorkExp(next);
                }}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Education */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">Education</CardTitle>
            <CardDescription>Degrees and academic institutions</CardDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              setEducation([
                ...education,
                { institution: "", degree: "", field: "", endDate: "" },
              ])
            }
          >
            <Plus className="h-4 w-4" /> Add Education
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {education.map((ed, idx) => (
            <div
              key={idx}
              className="grid grid-cols-1 md:grid-cols-4 gap-3 rounded-xl border p-3"
            >
              <Input
                placeholder="Institution"
                value={ed.institution || ""}
                onChange={(e) => {
                  const next = [...education];
                  next[idx] = { ...ed, institution: e.target.value };
                  setEducation(next);
                }}
              />
              <Input
                placeholder="Degree (e.g. Master / Ingénieur d'État)"
                value={ed.degree || ""}
                onChange={(e) => {
                  const next = [...education];
                  next[idx] = { ...ed, degree: e.target.value };
                  setEducation(next);
                }}
              />
              <Input
                placeholder="Field of Study"
                value={ed.field || ""}
                onChange={(e) => {
                  const next = [...education];
                  next[idx] = { ...ed, field: e.target.value };
                  setEducation(next);
                }}
              />
              <div className="flex gap-2">
                <Input
                  placeholder="Graduation Year"
                  value={ed.endDate || ""}
                  onChange={(e) => {
                    const next = [...education];
                    next[idx] = { ...ed, endDate: e.target.value };
                    setEducation(next);
                  }}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() =>
                    setEducation(education.filter((_, i) => i !== idx))
                  }
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </form>
  );
}
