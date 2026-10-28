namespace DbStudio.Import.Generate;

/// <summary>Small built-in word lists (no external data): enough variety for realistic looking test rows.</summary>
internal static class WordLists
{
    public static readonly string[] FirstNames =
    [
        "James", "Mary", "John", "Patricia", "Robert", "Jennifer", "Michael", "Linda", "William", "Elizabeth", "David", "Barbara", "Richard", "Susan",
        "Joseph", "Jessica", "Thomas", "Sarah", "Charles", "Karen", "Daniel", "Nancy", "Matthew", "Lisa", "Anthony", "Betty", "Mark", "Margaret", "Donald",
        "Sandra", "Steven", "Ashley", "Paul", "Kimberly", "Andrew", "Emily", "Joshua", "Donna", "Kenneth", "Michelle", "Kevin", "Carol", "Brian", "Amanda",
        "George", "Melissa", "Edward", "Deborah", "Ronald", "Stephanie", "Timothy", "Rebecca", "Jason", "Laura", "Jeffrey", "Sharon", "Ryan", "Cynthia",
        "Jacob", "Kathleen", "Gary", "Amy", "Nicholas", "Angela", "Eric", "Shirley", "Jonathan", "Anna", "Stephen", "Brenda", "Larry", "Pamela", "Justin",
        "Emma", "Scott", "Nicole", "Brandon", "Helen", "Benjamin", "Samantha", "Samuel", "Katherine", "Gregory", "Christine", "Alexander", "Debra", "Patrick",
        "Rachel", "Frank", "Carolyn", "Raymond", "Janet", "Jack", "Maria", "Dennis", "Olivia", "Jerry", "Heather", "Tyler", "Diane", "Aaron", "Julie",
        "Henry", "Joyce", "Adam", "Victoria", "Douglas", "Kelly", "Nathan", "Christina", "Peter", "Lauren", "Zachary", "Joan", "Kyle", "Evelyn", "Walter",
        "Megan", "Ethan", "Andrea", "Jeremy", "Cheryl", "Harold", "Hannah", "Keith", "Jacqueline", "Christian", "Martha", "Roger", "Gloria", "Noah", "Teresa",
        "Gerald", "Ann", "Carl", "Sara", "Terry", "Madison", "Sean", "Frances", "Austin", "Kathryn", "Arthur", "Janice", "Lawrence", "Jean", "Jesse", "Abigail",
        "Dylan", "Alice", "Bryan", "Julia", "Joe", "Judy", "Jordan", "Sophia", "Billy", "Grace", "Bruce", "Denise", "Albert", "Amber", "Willie", "Doris",
        "Gabriel", "Marilyn", "Logan", "Danielle", "Alan", "Beverly", "Juan", "Isabella", "Wayne", "Theresa", "Roy", "Diana", "Ralph", "Natalie", "Randy", "Brittany",
        "Eugene", "Charlotte", "Vincent", "Marie", "Russell", "Kayla", "Elijah", "Alexis", "Louis", "Lori",
    ];

    public static readonly string[] LastNames =
    [
        "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez", "Wilson",
        "Anderson", "Thomas", "Taylor", "Moore", "Jackson", "Martin", "Lee", "Perez", "Thompson", "White", "Harris", "Sanchez", "Clark", "Ramirez", "Lewis",
        "Robinson", "Walker", "Young", "Allen", "King", "Wright", "Scott", "Torres", "Nguyen", "Hill", "Flores", "Green", "Adams", "Nelson", "Baker", "Hall",
        "Rivera", "Campbell", "Mitchell", "Carter", "Roberts", "Gomez", "Phillips", "Evans", "Turner", "Diaz", "Parker", "Cruz", "Edwards", "Collins", "Reyes",
        "Stewart", "Morris", "Morales", "Murphy", "Cook", "Rogers", "Gutierrez", "Ortiz", "Morgan", "Cooper", "Peterson", "Bailey", "Reed", "Kelly", "Howard",
        "Ramos", "Kim", "Cox", "Ward", "Richardson", "Watson", "Brooks", "Chavez", "Wood", "James", "Bennett", "Gray", "Mendoza", "Ruiz", "Hughes", "Price",
        "Alvarez", "Castillo", "Sanders", "Patel", "Myers", "Long", "Ross", "Foster", "Jimenez", "Powell", "Jenkins", "Perry", "Russell", "Sullivan", "Bell",
        "Coleman", "Butler", "Henderson", "Barnes", "Gonzales", "Fisher", "Vasquez", "Simmons", "Romero", "Jordan", "Patterson", "Alexander", "Hamilton",
        "Graham", "Reynolds", "Griffin", "Wallace", "Moreno", "West", "Cole", "Hayes", "Bryant", "Herrera", "Gibson", "Ellis", "Tran", "Medina", "Aguilar",
        "Stevens", "Murray", "Ford", "Castro", "Marshall", "Owens", "Harrison", "Fernandez", "McDonald", "Woods", "Washington", "Kennedy", "Wells", "Vargas",
        "Henry", "Chen", "Freeman", "Webb", "Tucker", "Guzman", "Burns", "Crawford", "Olson", "Simpson", "Porter", "Hunter", "Gordon", "Mendez", "Silva",
        "Shaw", "Snyder", "Mason", "Dixon", "Munoz", "Hunt", "Hicks", "Holmes", "Palmer", "Wagner", "Black", "Robertson", "Boyd", "Rose", "Stone", "Salazar",
    ];

    public static readonly string[] Cities =
    [
        "New York", "Los Angeles", "Chicago", "Houston", "Phoenix", "Philadelphia", "San Antonio", "San Diego", "Dallas", "San Jose", "Austin", "Jacksonville",
        "Fort Worth", "Columbus", "Charlotte", "Indianapolis", "Seattle", "Denver", "Boston", "Nashville", "Portland", "Las Vegas", "Detroit", "Memphis",
        "Atlanta", "Miami", "Toronto", "Vancouver", "Montreal", "Calgary", "London", "Manchester", "Birmingham", "Glasgow", "Edinburgh", "Dublin", "Paris",
        "Lyon", "Marseille", "Berlin", "Munich", "Hamburg", "Cologne", "Frankfurt", "Madrid", "Barcelona", "Valencia", "Seville", "Rome", "Milan", "Naples",
        "Turin", "Amsterdam", "Rotterdam", "Brussels", "Vienna", "Zurich", "Geneva", "Stockholm", "Oslo", "Copenhagen", "Helsinki", "Warsaw", "Prague",
        "Budapest", "Athens", "Lisbon", "Istanbul", "Ankara", "Tehran", "Isfahan", "Shiraz", "Tabriz", "Dubai", "Doha", "Cairo", "Nairobi", "Lagos",
        "Cape Town", "Mumbai", "Delhi", "Bangalore", "Chennai", "Karachi", "Dhaka", "Bangkok", "Jakarta", "Manila", "Singapore", "Kuala Lumpur", "Hanoi",
        "Seoul", "Tokyo", "Osaka", "Kyoto", "Beijing", "Shanghai", "Shenzhen", "Hong Kong", "Sydney", "Melbourne", "Brisbane", "Perth", "Auckland",
        "Wellington", "Sao Paulo", "Rio de Janeiro", "Buenos Aires", "Santiago", "Lima", "Bogota", "Mexico City", "Guadalajara",
    ];

    public static readonly string[] Countries =
    [
        "United States", "Canada", "Mexico", "Brazil", "Argentina", "Chile", "Colombia", "Peru", "United Kingdom", "Ireland", "France", "Germany", "Spain",
        "Portugal", "Italy", "Netherlands", "Belgium", "Switzerland", "Austria", "Sweden", "Norway", "Denmark", "Finland", "Poland", "Czechia", "Hungary",
        "Greece", "Turkey", "Iran", "Iraq", "Egypt", "Morocco", "Nigeria", "Kenya", "South Africa", "United Arab Emirates", "Qatar", "India", "Pakistan",
        "Bangladesh", "Thailand", "Vietnam", "Indonesia", "Philippines", "Malaysia", "Singapore", "China", "Japan", "South Korea", "Australia", "New Zealand",
    ];

    public static readonly string[] Streets =
    [
        "Main", "Oak", "Pine", "Maple", "Cedar", "Elm", "Washington", "Lake", "Hill", "Park", "Sunset", "Church", "Highland", "River", "Meadow", "Spring",
        "Walnut", "Chestnut", "Willow", "Jackson", "Franklin", "Lincoln", "Jefferson", "Madison", "Adams", "Forest", "Ridge", "Valley", "Mill", "Bridge",
    ];

    public static readonly string[] StreetSuffixes = ["Street", "Avenue", "Road", "Boulevard", "Lane", "Drive", "Court", "Way", "Place", "Terrace"];

    public static readonly string[] CompanyPrefixes =
    [
        "Apex", "Blue", "Summit", "Nova", "Pioneer", "Vertex", "Horizon", "Atlas", "Quantum", "Evergreen", "Silverline", "Northwind", "Redwood", "Bright",
        "Stellar", "Ironclad", "Harbor", "Cobalt", "Zenith", "Falcon", "Orbit", "Granite", "Lumen", "Keystone", "Crescent", "Beacon", "Cascade", "Trident",
    ];

    public static readonly string[] CompanyNouns =
    [
        "Systems", "Labs", "Industries", "Solutions", "Dynamics", "Logistics", "Holdings", "Partners", "Works", "Technologies", "Foods", "Energy", "Media",
        "Networks", "Capital", "Designs", "Supply", "Materials", "Analytics", "Robotics",
    ];

    public static readonly string[] CompanySuffixes = ["Inc", "LLC", "Ltd", "Group", "Corp", "Co", "GmbH", "PLC"];

    public static readonly string[] JobTitles =
    [
        "Software Engineer", "Data Analyst", "Product Manager", "Project Manager", "Accountant", "Sales Representative", "Marketing Specialist", "Designer",
        "Customer Support Agent", "Operations Manager", "HR Generalist", "Financial Analyst", "Database Administrator", "DevOps Engineer", "QA Engineer",
        "Office Manager", "Legal Counsel", "Research Scientist", "Business Analyst", "Technical Writer", "Network Engineer", "Warehouse Supervisor",
        "Account Executive", "Consultant", "Teacher", "Nurse", "Electrician", "Mechanic", "Chef", "Architect",
    ];

    public static readonly string[] Domains = ["example.com", "example.org", "example.net", "mail.example.com", "test.example.org"];

    public static readonly string[] Tlds = ["com", "org", "net", "io", "dev", "app"];

    public static readonly string[] Colors =
    [
        "Red", "Orange", "Yellow", "Green", "Blue", "Purple", "Pink", "Brown", "Black", "White", "Gray", "Teal", "Navy", "Maroon", "Olive", "Cyan", "Magenta",
        "Silver", "Gold", "Beige",
    ];

    public static readonly string[] Lorem =
    [
        "lorem", "ipsum", "dolor", "sit", "amet", "consectetur", "adipiscing", "elit", "sed", "do", "eiusmod", "tempor", "incididunt", "ut", "labore", "et",
        "dolore", "magna", "aliqua", "enim", "ad", "minim", "veniam", "quis", "nostrud", "exercitation", "ullamco", "laboris", "nisi", "aliquip", "ex", "ea",
        "commodo", "consequat", "duis", "aute", "irure", "in", "reprehenderit", "voluptate", "velit", "esse", "cillum", "eu", "fugiat", "nulla", "pariatur",
        "excepteur", "sint", "occaecat", "cupidatat", "non", "proident", "sunt", "culpa", "qui", "officia", "deserunt", "mollit", "anim", "id", "est",
        "laborum", "pellentesque", "habitant", "morbi", "tristique", "senectus", "netus", "fames", "turpis", "egestas", "vestibulum", "tortor", "quam",
        "feugiat", "vitae", "ultricies", "leo", "integer", "malesuada", "bibendum", "arcu", "elementum", "curabitur", "vel", "hendrerit", "faucibus",
        "orci", "luctus", "posuere", "cubilia", "curae", "donec", "pharetra", "massa", "sapien", "ornare", "nibh", "praesent", "tellus", "mauris",
    ];

    public static readonly string[] Categories =
    [
        "Electronics", "Books", "Clothing", "Home & Garden", "Toys", "Sports", "Beauty", "Grocery", "Music", "Automotive", "Office", "Pet Supplies",
    ];
}
