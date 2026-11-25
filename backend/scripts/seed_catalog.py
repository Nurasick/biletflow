"""The public catalog for seed_demo.py: fifteen free listings in five cities.

These events exist so that discovery, search and the city and category filters
have something to show. Each is free, has one ticket type sized to its
capacity, and gets a few registrations. Photos live in
seed_assets/events/<slug>/.

Dates are relative: an event starts `days_ahead` days after the seed runs, at
`local_time` in its own timezone, so the catalog never goes stale.
"""

from dataclasses import dataclass

from app.models.event import EventCategory

DEMO_NOTE = "\n\nDemo listing for BiletFlow."


@dataclass(frozen=True)
class Listing:
    slug: str
    title: str
    category: EventCategory
    venue: str
    city: str
    capacity: int
    days_ahead: int
    local_time: str
    minutes: int
    blurb: str
    timezone: str = "Asia/Almaty"

    @property
    def address(self) -> str:
        return f"{self.venue}, {self.city}, Kazakhstan"

    @property
    def description(self) -> str:
        return self.blurb + DEMO_NOTE


CATALOG: tuple[Listing, ...] = (
    Listing(
        slug="demo-almaty-acoustic-sessions",
        title="Almaty Acoustic Sessions",
        category=EventCategory.CONCERT,
        venue="Archa Music Room",
        city="Almaty",
        capacity=90,
        days_ahead=2,
        local_time="19:00",
        minutes=120,
        blurb="Three local-style acoustic acts share an evening of guitar, vocals and "
        "original songs.",
    ),
    Listing(
        slug="demo-astana-design-exchange",
        title="Astana Design Exchange",
        category=EventCategory.CONFERENCE,
        venue="Northbank Studio",
        city="Astana",
        capacity=140,
        days_ahead=4,
        local_time="14:00",
        minutes=180,
        blurb="Short talks and a roundtable on building accessible digital products.",
    ),
    Listing(
        slug="demo-shymkent-community-futsal-cup",
        title="Shymkent Community Futsal Cup",
        category=EventCategory.SPORT,
        venue="Southern Court",
        city="Shymkent",
        capacity=180,
        days_ahead=7,
        local_time="11:00",
        minutes=240,
        blurb="Neighborhood teams play a round-robin tournament with spectator seating.",
    ),
    Listing(
        slug="demo-qyzylorda-shadow-theatre",
        title="Qyzylorda Shadow Theatre",
        category=EventCategory.THEATER,
        venue="Syr Arts Room",
        city="Qyzylorda",
        capacity=80,
        days_ahead=10,
        local_time="18:00",
        minutes=75,
        blurb="A family-friendly shadow-puppet performance inspired by tales of the Syr Darya.",
        timezone="Asia/Qyzylorda",
    ),
    Listing(
        slug="demo-almaty-clay-and-glaze-workshop",
        title="Almaty Clay and Glaze Workshop",
        category=EventCategory.OTHER,
        venue="Terracotta Studio",
        city="Almaty",
        capacity=24,
        days_ahead=12,
        local_time="13:00",
        minutes=120,
        blurb="Make a small ceramic bowl and try three glazing techniques in a guided workshop.",
    ),
    Listing(
        slug="demo-astana-chamber-music-matinee",
        title="Astana Chamber Music Matinee",
        category=EventCategory.CONCERT,
        venue="Riverlight Hall",
        city="Astana",
        capacity=120,
        days_ahead=15,
        local_time="16:00",
        minutes=90,
        blurb="A string quartet performs a program of chamber music and contemporary arrangements.",
    ),
    Listing(
        slug="demo-karaganda-open-data-meetup",
        title="Karaganda Open Data Meetup",
        category=EventCategory.CONFERENCE,
        venue="Steppe Innovation Room",
        city="Karaganda",
        capacity=65,
        days_ahead=17,
        local_time="18:00",
        minutes=120,
        blurb="Civic technology teams walk through public datasets and share short project demos.",
    ),
    Listing(
        slug="demo-almaty-winter-table-tennis-open",
        title="Almaty Winter Table Tennis Open",
        category=EventCategory.SPORT,
        venue="Eastside Sports Room",
        city="Almaty",
        capacity=95,
        days_ahead=20,
        local_time="12:00",
        minutes=180,
        blurb="Watch singles and doubles matches at a local table tennis showcase.",
    ),
    Listing(
        slug="demo-shymkent-short-play-festival",
        title="Shymkent Short Play Festival",
        category=EventCategory.THEATER,
        venue="Apricot Stage",
        city="Shymkent",
        capacity=110,
        days_ahead=23,
        local_time="19:00",
        minutes=100,
        blurb="Three short plays explore everyday life through comedy and drama.",
    ),
    Listing(
        slug="demo-astana-winter-photo-walk",
        title="Astana Winter Photo Walk",
        category=EventCategory.OTHER,
        venue="Northbank Arts Studio",
        city="Astana",
        capacity=32,
        days_ahead=25,
        local_time="11:00",
        minutes=90,
        blurb="A guided street photography walk with exercises in framing and winter light.",
    ),
    Listing(
        slug="demo-karaganda-folk-fusion-night",
        title="Karaganda Folk Fusion Night",
        category=EventCategory.CONCERT,
        venue="Copper String Hall",
        city="Karaganda",
        capacity=160,
        days_ahead=28,
        local_time="19:00",
        minutes=120,
        blurb="A live ensemble brings dombra melodies together with percussion and jazz "
        "arrangements.",
    ),
    Listing(
        slug="demo-almaty-student-product-forum",
        title="Almaty Student Product Forum",
        category=EventCategory.CONFERENCE,
        venue="Orchard Community Hub",
        city="Almaty",
        capacity=180,
        days_ahead=32,
        local_time="14:00",
        minutes=180,
        blurb="Student teams present prototypes, then exchange feedback with local product "
        "mentors.",
    ),
    Listing(
        slug="demo-astana-indoor-volleyball-showcase",
        title="Astana Indoor Volleyball Showcase",
        category=EventCategory.SPORT,
        venue="Northside Sports Court",
        city="Astana",
        capacity=220,
        days_ahead=36,
        local_time="15:00",
        minutes=180,
        blurb="Four amateur clubs meet for exhibition matches with open spectator seating.",
    ),
    Listing(
        slug="demo-almaty-improv-at-sundown",
        title="Almaty Improv at Sundown",
        category=EventCategory.THEATER,
        venue="Orchard Stage",
        city="Almaty",
        capacity=85,
        days_ahead=43,
        local_time="19:00",
        minutes=90,
        blurb="Two improv groups perform short scenes based on audience suggestions.",
    ),
    Listing(
        slug="demo-qyzylorda-zine-and-illustration-fair",
        title="Qyzylorda Zine and Illustration Fair",
        category=EventCategory.OTHER,
        venue="Syr Creative Space",
        city="Qyzylorda",
        capacity=150,
        days_ahead=50,
        local_time="12:00",
        minutes=240,
        blurb="Browse independent zines, prints and illustrated books and meet their makers.",
        timezone="Asia/Qyzylorda",
    ),
)
