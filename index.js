document.addEventListener("DOMContentLoaded", async function () {
    const foodKeywords = ["apero", "apéro", "pizza", "dinner", "breakfast", "lunch"];

    // Updated URLs to include the full domain for Nginx access
    const url = `https://akuta.xyz/api/food/`;
    const urlEthEvents = `${url}eth-events`;
    const urlEthCareers = `${url}eth-careers`;
    const urlAMIVEvents = `${url}amiv-events`;
    const urlVISEvents = `${url}vis-events`;
    const urlLastUpdated = `${url}last-updated`;

    // Function to fetch the last updated times and update the header
    async function updateLastUpdatedTime() {
        try {
            const response = await fetch(urlLastUpdated);
            const data = await response.json();

            // Format the last updated time for display
            const formatTimestamp = (timestamp) => {
                if (!timestamp) return "Loading...";
                const date = new Date(timestamp);
                // minutes if less than 1 hour ago, otherwise hours
                if ((Date.now() - date.getTime()) < 3600000) {
                    return `${Math.floor((Date.now() - date.getTime()) / 60000)} minutes ago`;
                } else if ((Date.now() - date.getTime()) < 7200000) {
                    return `${Math.floor((Date.now() - date.getTime()) / 3600000)} hour ago`;
                } else {
                    return `${Math.floor((Date.now() - date.getTime()) / 3600000)} hours ago`;
                }
            };

            // Set the text content for the last updated time
            document.getElementById("last-updated-time").textContent = `${formatTimestamp(data.ethEvents)}`;
        } catch (error) {
            console.error("Error fetching last updated times:", error);
        }
    }

    // Call the function to update the last updated time initially
    await updateLastUpdatedTime();

    // Set interval to refresh the "last updated" time every 5 minutes
    setInterval(updateLastUpdatedTime, 5 * 60 * 1000);

    // Declare allEvents globally so it's accessible to the dropdown filter as well
    let allEvents = [];

    // Fetch ETH Events, ETH Careers, and AMIV Events concurrently using Promise.all
    Promise.all([fetch(urlEthEvents), fetch(urlEthCareers), fetch(urlAMIVEvents), fetch(urlVISEvents)])
        .then(async ([responseEthEvents, responseEthCareers, responseAmivEvents, responseVisEvents]) => {

            // Parse the JSON responses from all APIs
            const ethEventsData = await responseEthEvents.json();
            const ethCareersData = await responseEthCareers.json();
            const amivEventsData = await responseAmivEvents.json();
            const visEventsData = await responseVisEvents.json();

            // Combine all events into a single array
            allEvents = [...ethEventsData, ...ethCareersData, ...amivEventsData, ...visEventsData];

            // Sort all events by date before rendering them
            allEvents.sort((a, b) => {
                const dateA = a.date.includes("~~") ? a.date.split(" ~~ ")[0] : a.date;
                const dateB = b.date.includes("~~") ? b.date.split(" ~~ ")[0] : b.date;
                return new Date(dateA) - new Date(dateB);
            });

            // make sure all dates in the list are in the future or today
            const today = new Date();
            allEvents = allEvents.filter(event => {
                const date = event.date.includes("~~") ? event.date.split(" ~~ ")[1] : event.date;
                return new Date(date) >= today;
            });

            // Call function to display sorted events
            displayEvents(allEvents);
        })
        .catch(error => {
            console.error("Error fetching events data:", error);
        });

    // Function to display events on the page
    function displayEvents(events) {
        const eventWrapper = document.getElementById("event-wrapper");
        eventWrapper.innerHTML = ""; // Clear existing events
        // Loop through each event and create HTML elements to display it
        events.forEach(event => {
            // Create the outer event container
            const eventContainer = document.createElement("div");
            eventContainer.className = "event-container";

            // Create the clickable inner content and link element
            const eventLink = document.createElement("a");
            eventLink.className = "event-link";
            eventLink.target = "_blank";

            // Determine the event link URL based on the event type
            if (event.orgType === "ethevents") {
                eventLink.href = `https://ethz.ch/en/news-and-events/events/details.${event.title.toLowerCase().replace(/[^0-9a-zA-Z]+/g, "-").slice(0, -1)}.${event.id}.html`;
            } else if (event.orgType === "ethcareers") {
                eventLink.href = `https://ethcareer.ch/en/events/detail/?id=${event.id}`;
            } else if (event.orgType === "amiv") {
                eventLink.href = `https://amiv.ethz.ch/en/events/signup/${event.id}/`;
            } else if (event.orgType === "vis") {
                eventLink.href = event.link;
            }

            // Highlight keywords related to food in the link
            const keyword = foodKeywords.find(keyword => event.title.toLowerCase().includes(keyword) || (event.description && event.description.toLowerCase().includes(keyword)));
            if (keyword) {
                eventLink.href += `#:~:text=${encodeURIComponent(keyword)}`;
            }

            // Create the inner content wrapper
            const eventInnerContent = document.createElement("div");
            eventInnerContent.className = "event-inner-content";

            // Set the event background color based on event type
            if (event.orgType === "ethevents") {
                eventContainer.style.backgroundColor = "#e7eaef";
            } else if (event.orgType === "ethcareers") {
                eventContainer.style.backgroundColor = "#e0f7fa";
            } else if (event.orgType === "amiv") {
                eventContainer.style.backgroundColor = "#fbcebf";
            } else if (event.orgType === "vis") {
                eventContainer.style.backgroundColor = "#fbf6b9";
            }

            // Calculate "Begins in x days"
            const today = new Date();
            let daysUntil = "";
            if (event.date.includes("~~")) {
                // check whether the first date is in the past
                const firstDate = new Date(event.date.split(" ~~ ")[0]);
                if (firstDate < today) {
                    const date = event.date.split(" ~~ ")[1];
                    daysUntil = "Ends in " + Math.ceil((new Date(date) - today) / (1000 * 60 * 60 * 24)) + " days";
                } else {
                    daysUntil = "Begins in " + Math.ceil((firstDate - today) / (1000 * 60 * 60 * 24)) + " days";
                }
            } else {
                const eventDate = new Date(event.date.includes("~~") ? event.date.split(" ~~ ")[0] : event.date);
                if (eventDate === today) {
                    daysUntil = "Is today";
                    // check if only one day:
                } else if (Math.ceil((eventDate - today) / (1000 * 60 * 60 * 24)) === 1) {
                    daysUntil = "Begins tomorrow";
                } else if (Math.ceil((eventDate - today) / (1000 * 60 * 60 * 24)) < 28) {
                    daysUntil = "Begins in " + Math.ceil((eventDate - today) / (1000 * 60 * 60 * 24)) + " days";
                } else if (Math.ceil((eventDate - today) / (1000 * 60 * 60 * 24)) > 28 && Math.ceil((eventDate - today) / (1000 * 60 * 60 * 24)) < 33) {
                    daysUntil = "Begins in a month";
                } else if (Math.ceil((eventDate - today) / (1000 * 60 * 60 * 24)) >= 35) {
                    daysUntil = "Begins in " + Math.ceil((eventDate - today) / (1000 * 60 * 60 * 24) / 30) + " months";
                }
            }

            // Create the date box to display event date details
            const dateBox = document.createElement("div");
            dateBox.className = "event-date-box";

            const [y, m, d] = (event.date.includes("~~") ? event.date.split(" ~~ ")[0] : event.date.split("\n")[0]).split("-").map(Number);
            const dateObj = new Date(y, m - 1, d);
            dateBox.innerHTML = `
					<div class="event-date-day">${d}</div>
					<div class="event-date-month-year">
					<div>${dateObj.toLocaleString('default', {weekday:'short'})}</div>
					<div>${dateObj.toLocaleString('default', {month:'short'})}</div>
					<div>${y}</div>
				</div>
				<div class="event-begins-in">${daysUntil}</div>`;

            // let dateParts = event.date.includes("~~") ? event.date.split(" ~~ ")[0].split("-") : event.date.split("\n")[0].split("-");
            // dateBox.innerHTML = `
            // <div class="event-date-day">${dateParts[2]}</div>
            // <div class="event-date-month-year">
            // <div>${new Date(dateParts.join()).toLocaleString('default', {weekday: 'short'})}</div>
            // <div>${new Date(dateParts.join()).toLocaleString('default', {month: 'short'})}</div>
            // <div>${dateParts[0]}</div>
            // </div>
            // <div class="event-begins-in">${daysUntil}</div>`;

            // Create the event details container
            const eventDetails = document.createElement("div");
            eventDetails.className = "event-details";

            // Create the event tags container and add necessary tags
            const eventTags = document.createElement("div");
            eventTags.className = "event-tags";

            if (event.date.includes("~~")) {
                const multiDateTag = document.createElement("span");
                multiDateTag.className = "event-tag";
                multiDateTag.textContent = "Event Series";
                eventTags.appendChild(multiDateTag);
            }

            if (event.reg_required) {
                const regRequiredTag = document.createElement("span");
                regRequiredTag.className = "event-tag";
                regRequiredTag.textContent = "Registration Required";
                eventTags.appendChild(regRequiredTag);
            }

            if (event.entryType) {
                const entryTypeTag = document.createElement("span");
                entryTypeTag.className = "event-tag";
                entryTypeTag.textContent = event.entryType;
                eventTags.appendChild(entryTypeTag);
            }

            if (event.closed_event) {
                const closedEventTag = document.createElement("span");
                closedEventTag.className = "event-tag";
                closedEventTag.textContent = "Closed event";
                eventTags.appendChild(closedEventTag);
            }

            if (event.type) {
                const typeTag = document.createElement("span");
                typeTag.className = "event-tag";
                typeTag.textContent = event.type.charAt(0).toUpperCase() + event.type.slice(1);
                eventTags.appendChild(typeTag);
            }

            if (event.spotsLeft != null) {
                const spotsLeftTag = document.createElement("span");
                spotsLeftTag.className = "event-tag";
                spotsLeftTag.textContent = `${event.spotsLeft} spots left`;
                eventTags.appendChild(spotsLeftTag);
            } else if (event.waitList != null) {
                const waitListTag = document.createElement("span");
                waitListTag.className = "event-tag";
                waitListTag.textContent = `${event.waitList} on waitlist`;
                eventTags.appendChild(waitListTag);
            }

            if (event.targetGroup) {
                const targetGroupTag = document.createElement("span");
                targetGroupTag.className = "event-tag";
                targetGroupTag.textContent = event.targetGroup;
                eventTags.appendChild(targetGroupTag);
            }

            if (event.category) {
                const categoryTag = document.createElement("span");
                categoryTag.className = "event-tag";
                categoryTag.textContent = event.category;
                eventTags.appendChild(categoryTag);
            }

            // Create the event title element
            const eventTitle = document.createElement("div");
            eventTitle.className = "event-title";
            eventTitle.textContent = event.title;

            // Create the event information table
            const eventInfoTable = document.createElement("table");
            eventInfoTable.className = "event-info-table";
            eventInfoTable.innerHTML = `
                    <tr>
                        <th>Time</th>
                        <td>${event.times.replace(/:\d{4}$/, '')}</td>
                    </tr>
                    <tr>
                        <th>Location</th>
                        <td>${event.location.split(",").join("<br>")}</td>
                    </tr>
                    <tr>
                        <th>Organizer</th>
                        <td>${event.organizer}</td>
                    </tr>`;

            // Append the event tags, title, and info table to the event details
            eventDetails.appendChild(eventTags);
            eventDetails.appendChild(eventTitle);
            eventDetails.appendChild(eventInfoTable);

            // Append the date box and event details to the event inner content
            eventInnerContent.appendChild(dateBox);
            eventInnerContent.appendChild(eventDetails);

            // Append the inner content to the link
            eventLink.appendChild(eventInnerContent);

            // Append the link to the outer container
            eventContainer.appendChild(eventLink);

            // Append the event container to the main event wrapper on the page
            eventWrapper.appendChild(eventContainer);
        });
    }

    const filterDropdownBtn = document.getElementById("filter-dropdown-btn");
    const filterCheckboxes = document.querySelectorAll(".filter-checkbox");
    const customDropdown = document.getElementById("filter-dropdown");

    // Toggle dropdown content when clicking the button
    filterDropdownBtn.addEventListener("click", function (e) {
        e.stopPropagation(); // Prevent the event from bubbling up
        customDropdown.classList.toggle("open");
    });

    // Close dropdown when clicking outside
    document.addEventListener("click", function (e) {
        if (!customDropdown.contains(e.target)) {
            customDropdown.classList.remove("open");
        }
    });

    // Event listener for filter checkboxes
    filterCheckboxes.forEach(checkbox => {
        checkbox.addEventListener("change", () => {
            applyFilters();
            updateLegendVisibility();
        });
    });


    // Function to update the visibility of legend items based on selected filters
    function updateLegendVisibility() {
        // Organization checkboxes and legend items mapping
        const orgLegendMapping = {
            "ethevents": "legend-ethevents",
            "ethcareers": "legend-ethcareers",
            "amiv": "legend-amiv",
            "vis": "legend-vis"
        };

        // Loop through each organization type
        Object.keys(orgLegendMapping).forEach(orgType => {
            const checkbox = document.getElementById(`org-${orgType}`);
            const legendItem = document.getElementById(orgLegendMapping[orgType]);

            // Show or hide legend item based on checkbox state
            if (checkbox.checked) {
                legendItem.style.display = "flex";
            } else {
                legendItem.style.display = "none";
            }
        });
    }

    // Function to apply both organization and tag filters
    function applyFilters() {
        // Gather all checked organization filters
        const selectedOrgs = Array.from(filterCheckboxes)
            .filter(checkbox => checkbox.checked && checkbox.id.startsWith("org-"))
            .map(checkbox => checkbox.value);

        // Gather all UNchecked tags (these are the ones we want to hide)
        const unselectedTags = Array.from(filterCheckboxes)
            .filter(checkbox => !checkbox.checked && checkbox.id.startsWith("tag-"))
            .map(checkbox => checkbox.value);

        let filteredEvents = allEvents;

        // Apply organization filter if at least one organization is selected
        if (selectedOrgs.length > 0) {
            filteredEvents = filteredEvents.filter(event => selectedOrgs.includes(event.orgType));
        }

        // Hide events that have any of the unticked tags
        if (unselectedTags.length > 0) {
            filteredEvents = filteredEvents.filter(event => {
                const eventTags = getEventTags(event);
                // Exclude events that have ANY of the unticked tags
                return !unselectedTags.some(tag => eventTags.includes(tag));
            });
        }

        // Display the filtered events
        displayEvents(filteredEvents);
    }

    // Function to extract tags from an event
    function getEventTags(event) {
        const tags = [];
        if (event.date.includes("~~")) {
            tags.push("Event Series");
        }
        if (event.reg_required) {
            tags.push("Registration Required");
        }
        if (event.closed_event) {
            tags.push("Closed event");
        }
        if (event.spotsLeft === null) {
            tags.push("waitlist");
        }
        if (event.type) {
            tags.push(event.type.charAt(0).toUpperCase() + event.type.slice(1));
        }
        if (event.entryType) {
            tags.push(event.entryType);
        }
        if (event.targetGroup) {
            tags.push(event.targetGroup);
        }
        if (event.category) {
            tags.push(event.category);
        }

        return tags;
    }

    // Initial display of events (all tags are initially checked)
    applyFilters();

    // Initial call to set the legend visibility based on default checkbox states
    updateLegendVisibility();
});
